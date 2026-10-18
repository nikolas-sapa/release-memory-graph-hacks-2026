import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import type { Response } from 'openai/resources/responses/responses.js';
import { createLocalHttpServer, type HttpGraphPort } from '../../src/http/server.js';
import { LOCAL_HOST, LOCAL_ORIGIN } from '../../src/http/boundary.js';
import type { EvidenceReport, EvidenceSource, IntentKey } from '../../src/contracts.js';
import { ReviewManager, type AtomicCommitResult, type PersistableReviewIntent, type PersistedReceipt, type ReceiptLookup } from '../../src/memory/save.js';
import type { ReviewSnapshot } from '../../src/memory/review.js';
import type { ResponsesProvider } from '../../src/agent/types.js';
import { GraphStoreError } from '../../src/graph/store.js';

const citation = { revisionId: 'revision:1', anchor: 'anchor:1', contentDigest: 'a'.repeat(64) };
const source: EvidenceSource = {
  revisionId: citation.revisionId,
  sourceId: 'source:1',
  revisionIdentity: 'r1',
  anchor: citation.anchor,
  contentDigest: citation.contentDigest,
  excerpt: 'Synthetic evidence for a fictional service.',
};

class FakeGraph implements HttpGraphPort {
  entityReads = 0;
  inspections = 0;
  sourceReads = 0;
  snapshotReads = 0;
  writes = 0;
  receiptReads = 0;
  modelCalls = 0;
  unavailable = false;
  snapshotUnavailable = false;
  outageAfterEntityRead = false;
  receipt: PersistedReceipt | null = null;

  async entities(): Promise<Array<{ id: string; name: string }>> {
    this.entityReads++;
    if (this.unavailable) throw new GraphStoreError('graph_unavailable', 'offline');
    const entities = [{ id: 'service:1', name: 'Service One' }];
    if (this.outageAfterEntityRead && this.entityReads > 1) this.unavailable = true;
    return entities;
  }

  async inspect(targetId: string, intent: IntentKey): Promise<EvidenceReport> {
    this.inspections++;
    if (this.unavailable) throw new GraphStoreError('graph_unavailable', 'offline');
    return reportFor(targetId, intent);
  }

  async source(requestId: string, revisionId: string, anchor: string): Promise<EvidenceSource> {
    this.sourceReads++;
    if (this.unavailable) throw new GraphStoreError('graph_unavailable', 'offline');
    if (requestId !== 'request:1' || revisionId !== source.revisionId || anchor !== source.anchor) {
      throw new GraphStoreError('integrity_failure', 'Source reference is outside the retrieval package');
    }
    return source;
  }

  async lookupReceipt(requestId: string): Promise<ReceiptLookup> {
    this.receiptReads++;
    if (this.unavailable) return { state: 'unavailable' };
    return this.receipt?.requestId === requestId ? { state: 'committed', receipt: this.receipt } : { state: 'absent' };
  }

  async readSnapshot(subjectId: string, decisionKey: string): Promise<ReviewSnapshot> {
    this.snapshotReads++;
    if (this.unavailable || this.snapshotUnavailable) throw new GraphStoreError('graph_unavailable', 'offline');
    return {
      subjectId,
      decisionKey,
      currentHeadId: null,
      lineageStatus: 'absent',
      materialInventory: [['edge:1', 'revision:1']],
      lineageInventory: [],
      validCitations: [citation],
    };
  }

  async atomicCommit(intent: PersistableReviewIntent): Promise<AtomicCommitResult> {
    this.writes++;
    this.receipt = {
      requestId: intent.requestId,
      decisionId: intent.decisionId,
      digest: intent.digest,
      canonicalJson: intent.canonicalJson,
      subjectId: intent.subjectId,
      decisionKey: intent.decisionKey,
      aboutEdgeId: `${intent.decisionId}:about`,
      citesEdgeIds: intent.citations.map((_, index) => `${intent.decisionId}:cites:${index}`),
      supersedesEdgeId: null,
    };
    return { state: 'created' };
  }

  async classifyDecision(): Promise<'current' | 'historical' | 'unknown' | 'unavailable'> {
    return this.unavailable ? 'unavailable' : 'current';
  }
}

function reportFor(targetId: string, intent: IntentKey): EvidenceReport {
  return {
    requestId: 'request:1',
    targetId,
    intent,
    status: 'complete',
    entities: { services: [targetId], projects: [], owners: [] },
    edges: [],
    paths: [{ nodeIds: [targetId], edgeIds: [] }],
    facts: [],
    sources: [source],
    decisions: [],
    gaps: [],
    completeness: { traversal: true, paths: true, lineage: true, sourceCoverage: true },
    limits: { depth: 6, pathCap: 100, overflow: false, frontierIds: [] },
  };
}

function providerFor(graph: FakeGraph, intent: IntentKey = 'owners'): ResponsesProvider {
  return {
    async create(): Promise<Response> {
      graph.modelCalls++;
      const output_text = graph.modelCalls === 1 ? JSON.stringify({ intent }) : '{"factIds":[],"actions":[]}';
      return { status: 'completed', output_text, incomplete_details: null } as Response;
    },
  };
}

interface Reply { status: number; headers: IncomingHttpHeaders; body: string }

function send(port: number, path: string, options: {
  method?: string; headers?: Record<string, string>; body?: string; pauseAfter?: string;
} = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: LOCAL_HOST, ...options.headers };
    const body = options.body;
    if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')
      && !Object.keys(headers).some((key) => key.toLowerCase() === 'transfer-encoding')) {
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }
    const request = httpRequest({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    if (options.pauseAfter) setTimeout(() => request.end(), 5200).unref();
    else request.end();
  });
}

async function withServer(run: (port: number, graph: FakeGraph, nonce: string) => Promise<void>, intent: IntentKey = 'owners'): Promise<void> {
  const graph = new FakeGraph();
  const server = createLocalHttpServer({ graph, reviews: new ReviewManager(graph), provider: providerFor(graph, intent) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const health = await send(address.port, '/api/health');
    assert.equal(health.status, 200);
    const nonce = health.headers['x-session-nonce'];
    assert.equal(typeof nonce, 'string');
    await run(address.port, graph, nonce as string);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function postHeaders(nonce: string): Record<string, string> {
  return { Origin: LOCAL_ORIGIN, 'Content-Type': 'application/json', 'X-Session-Nonce': nonce };
}

test('12 invalid boundary variants reject before model or graph mutation', async () => {
  await withServer(async (port, graph, nonce) => {
    const validBody = JSON.stringify({ targetId: 'service:1', question: 'Who owns this service?' });
    const cases: Array<{ name: string; options: Parameters<typeof send>[2] }> = [
      { name: 'foreign origin', options: { method: 'POST', headers: { ...postHeaders(nonce), Origin: 'https://attacker.test' }, body: validBody } },
      { name: 'null origin', options: { method: 'POST', headers: { ...postHeaders(nonce), Origin: 'null' }, body: validBody } },
      { name: 'missing origin', options: { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Nonce': nonce }, body: validBody } },
      { name: 'foreign host', options: { method: 'POST', headers: { ...postHeaders(nonce), Host: 'attacker.test' }, body: validBody } },
      { name: 'missing host', options: { method: 'POST', headers: { ...postHeaders(nonce), Host: '' }, body: validBody } },
      { name: 'wrong port', options: { method: 'POST', headers: { ...postHeaders(nonce), Host: '127.0.0.1:4318' }, body: validBody } },
      { name: 'form substitute', options: { method: 'POST', headers: { ...postHeaders(nonce), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'targetId=service%3A1' } },
      { name: 'missing nonce', options: { method: 'POST', headers: { Origin: LOCAL_ORIGIN, 'Content-Type': 'application/json' }, body: validBody } },
      { name: 'wrong nonce', options: { method: 'POST', headers: { ...postHeaders(`${nonce}x`) }, body: validBody } },
      { name: 'compressed body', options: { method: 'POST', headers: { ...postHeaders(nonce), 'Content-Encoding': 'gzip' }, body: validBody } },
      { name: 'unknown request field', options: { method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({ targetId: 'service:1', question: 'Who owns it?', query: 'MATCH (n) DELETE n' }) } },
      { name: 'oversized declared body', options: { method: 'POST', headers: { ...postHeaders(nonce), 'Content-Length': '65537' }, body: '' } },
    ];
    for (const item of cases) {
      const reply = await send(port, '/api/question', item.options);
      assert.ok(reply.status >= 400, `${item.name} should reject`);
    }
    const preflight = await send(port, '/api/question', { method: 'OPTIONS', headers: { Origin: 'https://attacker.test' } });
    assert.equal(preflight.status, 405);
    const head = await send(port, '/api/entities', { method: 'HEAD' });
    assert.equal(head.status, 204);
    assert.equal(graph.modelCalls, 0);
    assert.equal(graph.inspections, 0);
    assert.equal(graph.writes, 0);
    assert.equal(graph.entityReads, 1, 'only the setup health GET reads graph inventory');
  });
});

test('body cap applies to streamed bytes and body deadline is five seconds', async () => {
  await withServer(async (port, graph, nonce) => {
    const oversized = JSON.stringify({ targetId: 'service:1', question: 'x'.repeat(500) }).padEnd(65_537, ' ');
    const tooLarge = await send(port, '/api/question', {
      method: 'POST', headers: postHeaders(nonce), body: oversized,
    });
    assert.equal(tooLarge.status, 413);
    const started = Date.now();
    const timeout = await send(port, '/api/question', {
      method: 'POST',
      headers: { ...postHeaders(nonce), 'Content-Length': '2' },
      body: '{',
      pauseAfter: 'unused',
    });
    assert.equal(timeout.status, 408);
    assert.ok(Date.now() - started >= 4_900);
    assert.equal(graph.modelCalls, 0);
    assert.equal(graph.writes, 0);
  });
});

test('valid question, review, confirmation, and read-only status flow preserve boundaries', async () => {
  await withServer(async (port, graph, nonce) => {
    const question = await send(port, '/api/question', {
      method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({ targetId: 'service:1', question: 'Who owns this service?' }),
    });
    assert.equal(question.status, 200);
    const answer = JSON.parse(question.body) as { report: EvidenceReport; draft: { facts: unknown[] } };
    assert.equal(answer.report.targetId, 'service:1');
    assert.equal(answer.report.intent, 'owners');
    assert.deepEqual(answer.draft.facts, []);
    assert.equal(graph.modelCalls, 2);
    assert.equal(graph.inspections, 1);
    assert.equal(graph.writes, 0);

    const prepared = await send(port, '/api/reviews', {
      method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({
        subjectId: 'service:1', decisionKey: 'release-review', text: 'Retain service for now.',
        rationale: 'The cited evidence supports continued operation.', reviewerId: 'participant', citations: [citation],
      }),
    });
    assert.equal(prepared.status, 201);
    const intent = JSON.parse(prepared.body).review as { requestId: string; digest: string; confirmationNonce: string };
    assert.equal(graph.writes, 0, 'preparing a review must not write');

    const rejectedConfirmation = await send(port, '/api/reviews/confirm', {
      method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({
        requestId: intent.requestId, expectedDigest: intent.digest, confirmationNonce: intent.confirmationNonce,
        participantConfirmed: false,
      }),
    });
    assert.equal(rejectedConfirmation.status, 400);
    assert.equal(graph.writes, 0);

    const confirmed = await send(port, '/api/reviews/confirm', {
      method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({
        requestId: intent.requestId, expectedDigest: intent.digest, confirmationNonce: intent.confirmationNonce,
        participantConfirmed: true,
      }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal(graph.writes, 1);
    const status = await send(port, `/api/reviews/status?requestId=${encodeURIComponent(intent.requestId)}&digest=${intent.digest}`);
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body).status.state, 'committed');
    assert.equal(graph.writes, 1, 'status lookup must remain read-only');
    assert.equal(graph.modelCalls, 2, 'GETs and review/status do not call the model');
  });
});

test('unknown targets reject before inference and malformed read parameters reject', async () => {
  await withServer(async (port, graph, nonce) => {
    const unknown = await send(port, '/api/question', {
      method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({ targetId: 'service:missing', question: 'Who owns it?' }),
    });
    assert.equal(unknown.status, 404);
    assert.equal(graph.modelCalls, 0);
    assert.equal(graph.inspections, 0);
    const duplicate = await send(port, '/api/reviews/status?requestId=a&requestId=b&digest=' + 'a'.repeat(64));
    assert.equal(duplicate.status, 400);
    const sourceEscape = await send(port, '/api/source?requestId=other&revisionId=revision%3A1&anchor=anchor%3A1');
    assert.equal(sourceEscape.status, 409);
    assert.doesNotMatch(sourceEscape.body, /out of scope/);
    assert.equal(graph.writes, 0);
  });
});

test('new process issues a new nonce and health reflects graph outage', async () => {
  const firstGraph = new FakeGraph();
  const first = createLocalHttpServer({ graph: firstGraph, reviews: new ReviewManager(firstGraph), provider: providerFor(firstGraph) });
  first.listen(0, '127.0.0.1');
  await once(first, 'listening');
  const firstAddress = first.address();
  assert.ok(firstAddress && typeof firstAddress !== 'string');
  const firstHealth = await send(firstAddress.port, '/api/health');
  const firstNonce = firstHealth.headers['x-session-nonce'];
  first.closeAllConnections();
  await new Promise<void>((resolve, reject) => first.close((error) => error ? reject(error) : resolve()));

  const secondGraph = new FakeGraph();
  secondGraph.unavailable = true;
  const second = createLocalHttpServer({ graph: secondGraph, reviews: new ReviewManager(secondGraph), provider: providerFor(secondGraph) });
  second.listen(0, '127.0.0.1');
  await once(second, 'listening');
  const secondAddress = second.address();
  assert.ok(secondAddress && typeof secondAddress !== 'string');
  try {
    const health = await send(secondAddress.port, '/api/health');
    assert.equal(JSON.parse(health.body).graph, 'unavailable');
    assert.notEqual(health.headers['x-session-nonce'], firstNonce);
    const entities = await send(secondAddress.port, '/api/entities');
    assert.equal(entities.status, 503);
    assert.equal(secondGraph.writes, 0);
    assert.equal(secondGraph.modelCalls, 0);
  } finally {
    second.closeAllConnections();
    await new Promise<void>((resolve, reject) => second.close((error) => error ? reject(error) : resolve()));
  }
});

test('E12 graph outage rejects query instead of returning a fallback answer: 1/1', async () => {
  await withServer(async (port, graph, nonce) => {
    graph.unavailable = true;
    const reply = await send(port, '/api/question', {
      method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({ targetId: 'service:1', question: 'What depends on this service?' }),
    });
    assert.equal(reply.status, 503);
    assert.equal(JSON.parse(reply.body).error.code, 'graph_unavailable');
    assert.equal(graph.modelCalls, 0);
    assert.equal(graph.inspections, 0);
    assert.equal(graph.writes, 0);
    assert.doesNotMatch(reply.body, /"report"|"facts"|"decisions"/);
  }, 'impact');
});

test('T05 graph outage workflows fail explicitly with zero writes: 5/5', async (t) => {
  for (const scenario of [
    { name: 'impact', intent: 'impact' as const, question: 'What depends on this service?' },
    { name: 'owner', intent: 'owners' as const, question: 'Who owns this service?' },
    { name: 'rationale history', intent: 'history' as const, question: 'Why did we make this decision?' },
  ]) await t.test(`${scenario.name}: unavailable evidence returns no answer`, async () => {
    await withServer(async (port, graph, nonce) => {
      graph.outageAfterEntityRead = true;
      const reply = await send(port, '/api/question', {
        method: 'POST', headers: postHeaders(nonce),
        body: JSON.stringify({ targetId: 'service:1', question: scenario.question }),
      });
      assert.equal(reply.status, 503);
      assert.equal(JSON.parse(reply.body).error.code, 'graph_unavailable');
      assert.equal(graph.inspections, 1);
      assert.equal(graph.modelCalls, 1, 'intent selection may run; no answer-draft call after evidence outage');
      assert.equal(graph.writes, 0);
      assert.doesNotMatch(reply.body, /"report"|"facts"|"receipt"|"decisionId"/);
    }, scenario.intent);
  });

  await t.test('reviewed decision confirmation: outage during fresh evidence read stays uncertain', async () => {
    await withServer(async (port, graph, nonce) => {
      const prepared = await send(port, '/api/reviews', {
        method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({
          subjectId: 'service:1', decisionKey: 'release-review', text: 'Retain service for now.',
          rationale: 'The cited evidence supports continued operation.', reviewerId: 'participant', citations: [citation],
        }),
      });
      assert.equal(prepared.status, 201);
      const intent = JSON.parse(prepared.body).review as { requestId: string; digest: string; confirmationNonce: string };
      graph.snapshotUnavailable = true;
      const confirm = await send(port, '/api/reviews/confirm', {
        method: 'POST', headers: postHeaders(nonce), body: JSON.stringify({
          requestId: intent.requestId, expectedDigest: intent.digest,
          confirmationNonce: intent.confirmationNonce, participantConfirmed: true,
        }),
      });
      assert.equal(confirm.status, 503);
      assert.equal(JSON.parse(confirm.body).error.code, 'uncertain_write');
      assert.equal(graph.receiptReads, 1, 'receipt was checked before the read failure');
      assert.equal(graph.snapshotReads, 2, 'preparation succeeded; confirmation reread failed');
      assert.equal(graph.writes, 0);
      assert.doesNotMatch(confirm.body, /"decisionId"|"receipt"|"committed"/);
    });
  });

  await t.test('source citation: unavailable lookup returns no excerpt', async () => {
    await withServer(async (port, graph) => {
      graph.unavailable = true;
      const reply = await send(port, `/api/source?requestId=request%3A1&revisionId=${encodeURIComponent(citation.revisionId)}&anchor=${encodeURIComponent(citation.anchor)}`);
      assert.equal(reply.status, 503);
      assert.equal(JSON.parse(reply.body).error.code, 'graph_unavailable');
      assert.equal(graph.sourceReads, 1);
      assert.equal(graph.writes, 0);
      assert.doesNotMatch(reply.body, /Synthetic evidence|excerpt|"sourceId"/);
    });
  });
});
