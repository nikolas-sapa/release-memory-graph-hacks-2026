import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { FalkorDB } from 'falkordb';
import { GraphStore } from '../../src/graph/store.js';
import { ReviewManager } from '../../src/memory/save.js';
import { ReviewError } from '../../src/memory/review.js';

const graphName = 'm01_memory_contract';
const marker = 'm01_memory_contract_fixture_v1';
const serviceId = 'service:m01';
const personId = 'person:m01';
const documentId = 'document:m01';
const edgeId = 'edge:m01';
const anchor = 'section-m01/paragraph-01';
const content = `At ${anchor}, fictional review asserts ${personId} OWNS ${serviceId} with current validity and reviewed review state.`;
const digest = createHash('sha256').update(content).digest('hex');

test('M01 real FalkorDB adapter: atomic save, durable receipt-first retry, advanced-scope historical ID, stale zero-write', async () => {
  const db = await FalkorDB.connect({ url: 'redis://127.0.0.1:6379', socket: { connectTimeout: 2000 } });
  const graph = db.selectGraph(graphName);
  await graph.query('MATCH (n) DETACH DELETE n', { TIMEOUT: 2000 });
  await graph.query(`CREATE (s:Service {type:'Service',semantic_id:$serviceId,name:'M01 test service',m01_fixture:$marker})
    CREATE (p:Person {type:'Person',semantic_id:$personId,name:'M01 test owner',m01_fixture:$marker})
    CREATE (doc:Document {type:'Document',semantic_id:$documentId,name:'M01 test source',source_id:'source:m01',
      revision_identity:'revision:m01',content:$content,content_digest:$digest,applicability_state:'current',m01_fixture:$marker})
    CREATE (p)-[:OWNS {type:'OWNS',relationship_id:$edgeId,source_id_endpoint:$personId,target_id:$serviceId,
      source_id:'source:m01',document_revision_id:$documentId,anchor:$anchor,asserted_at:'2026-10-15T00:00:00.000Z',
      validity_state:'current',review_state:'reviewed'}]->(s)`,
    { params: { serviceId, personId, documentId, content, digest, edgeId, anchor, marker }, TIMEOUT: 2000 });
  const store = await GraphStore.connect({ url: 'redis://127.0.0.1:6379', graphName, timeoutMs: 2000 });
  try {
    const manager = new ReviewManager(store);
    const initialSnapshot = await store.readSnapshot(serviceId, 'release');
    assert.equal(initialSnapshot.subjectId, serviceId);
    assert.equal(initialSnapshot.lineageStatus, 'absent');
    assert.ok(initialSnapshot.validCitations.some((item) => item.revisionId === documentId && item.anchor === anchor && item.contentDigest === digest));
    const first = await manager.prepare({ subjectId: serviceId, decisionKey: 'release', text: 'Retain test service',
      rationale: 'The reviewed owner edge supports retaining this service.', reviewerId: personId,
      citations: [{ revisionId: documentId, anchor, contentDigest: digest }] });
    const saved = await manager.confirm({ requestId: first.requestId, expectedDigest: first.digest,
      confirmationNonce: first.confirmationNonce, participantConfirmed: true });
    assert.deepEqual(saved, { state: 'committed', decisionId: first.decisionId, classification: 'current' });
    const firstReceipt = await store.lookupReceipt(first.requestId);
    assert.equal(firstReceipt.state, 'committed');
    if (firstReceipt.state === 'committed') {
      assert.equal(firstReceipt.receipt.decisionId, first.decisionId);
      assert.equal(firstReceipt.receipt.citesEdgeIds.length, 1);
    }

    const queriesBeforeRetry = await graph.roQuery<{ count: number }>('MATCH (d:Decision) RETURN count(d) AS count');
    const retry = await manager.confirm({ requestId: first.requestId, expectedDigest: first.digest,
      confirmationNonce: 'old-after-commit', participantConfirmed: false });
    assert.deepEqual(retry, saved);
    assert.equal((await graph.roQuery<{ count: number }>('MATCH (d:Decision) RETURN count(d) AS count')).data?.[0]?.count,
      queriesBeforeRetry.data?.[0]?.count);

    const second = await manager.prepare({ subjectId: serviceId, decisionKey: 'release', text: 'Retain test service again',
      rationale: 'The same reviewed owner edge remains relevant.', reviewerId: personId,
      citations: [{ revisionId: documentId, anchor, contentDigest: digest }] });
    const secondSaved = await manager.confirm({ requestId: second.requestId, expectedDigest: second.digest,
      confirmationNonce: second.confirmationNonce, participantConfirmed: true });
    assert.equal(secondSaved.state, 'committed');
    const historicalRetry = await manager.confirm({ requestId: first.requestId, expectedDigest: first.digest,
      confirmationNonce: 'expired', participantConfirmed: false });
    assert.deepEqual(historicalRetry, { state: 'committed', decisionId: first.decisionId, classification: 'historical' });

    const stale = await manager.prepare({ subjectId: serviceId, decisionKey: 'release', text: 'Stale review',
      rationale: 'This review must be rejected after material changes.', reviewerId: personId,
      citations: [{ revisionId: documentId, anchor, contentDigest: digest }] });
    await graph.query('MATCH ()-[r:OWNS {relationship_id:$edgeId}]->() SET r.anchor=$changedAnchor',
      { params: { edgeId, changedAnchor: 'section-m01/changed' }, TIMEOUT: 2000 });
    const countBeforeStale = (await graph.roQuery<{ count: number }>('MATCH (d:Decision) RETURN count(d) AS count')).data?.[0]?.count;
    await assert.rejects(manager.confirm({ requestId: stale.requestId, expectedDigest: stale.digest,
      confirmationNonce: stale.confirmationNonce, participantConfirmed: true }),
    (error: unknown) => error instanceof ReviewError && error.code === 'stale_review');
    assert.equal((await graph.roQuery<{ count: number }>('MATCH (d:Decision) RETURN count(d) AS count')).data?.[0]?.count, countBeforeStale);
  } finally {
    await store.close();
    await graph.query('MATCH (n) DETACH DELETE n', { TIMEOUT: 2000 });
    await db.close();
  }
});
