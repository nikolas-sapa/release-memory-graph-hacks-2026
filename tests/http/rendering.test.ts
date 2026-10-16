import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import type { EvidenceReport, EvidenceSource, IntentKey } from '../../src/contracts.js';
import type { ResponsesProvider } from '../../src/agent/types.js';
import { createLocalHttpServer, type HttpGraphPort } from '../../src/http/server.js';
import { LOCAL_HOST } from '../../src/http/boundary.js';
import { ReviewManager, type PersistableReviewIntent, type ReceiptLookup, type AtomicCommitResult } from '../../src/memory/save.js';
import type { ReviewSnapshot } from '../../src/memory/review.js';

const report: EvidenceReport = {
  requestId: 'request:render', targetId: 'service:render', intent: 'impact', status: 'complete',
  entities: { services: ['service:render'], projects: [], owners: [] }, edges: [], paths: [], facts: [], sources: [], decisions: [], gaps: [],
  completeness: { traversal: true, paths: true, lineage: true, sourceCoverage: true },
  limits: { depth: 6, pathCap: 100, overflow: false, frontierIds: [] },
};

const graph: HttpGraphPort = {
  async entities(): Promise<Array<{ id: string; name: string }>> { return [{ id: 'service:render', name: '<script>alert(1)</script>' }]; },
  async inspect(targetId: string, intent: IntentKey): Promise<EvidenceReport> { return { ...report, targetId, intent }; },
  async source(): Promise<EvidenceSource> { throw new Error('not found'); },
  async lookupReceipt(): Promise<ReceiptLookup> { return { state: 'absent' }; },
  async readSnapshot(subjectId: string, decisionKey: string): Promise<ReviewSnapshot> {
    return { subjectId, decisionKey, currentHeadId: null, lineageStatus: 'absent', materialInventory: [], lineageInventory: [], validCitations: [] };
  },
  async atomicCommit(_intent: PersistableReviewIntent): Promise<AtomicCommitResult> { return { state: 'uncertain' }; },
  async classifyDecision(): Promise<'current' | 'historical' | 'unknown' | 'unavailable'> { return 'unknown'; },
};

const provider: ResponsesProvider = { async create() { throw new Error('not used'); } };

function get(port: number, path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method, headers: { Host: LOCAL_HOST } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

test('UI serves only fixed local assets with strict CSP and hostile text stays JSON data', async () => {
  const server = createLocalHttpServer({ graph, reviews: new ReviewManager(graph), provider });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const page = await get(address.port, '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.doesNotMatch(page.body, /<script(?![^>]*\bsrc=)[^>]*>/i);
    assert.doesNotMatch(page.body, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(page.body, /https?:\/\//i);

    const css = await get(address.port, '/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.body, /font-family: "Geist Sans"/);
    assert.match(css.body, /prefers-reduced-motion/);
    assert.doesNotMatch(css.body, /linear-gradient|orange/i);

    const js = await get(address.port, '/app.js');
    assert.equal(js.status, 200);
    assert.match(js.body, /\.textContent\s*=/);
    assert.doesNotMatch(js.body, /\.innerHTML\s*=|document\.write|\beval\s*\(/);

    const entities = await get(address.port, '/api/entities');
    assert.equal(entities.status, 200);
    const payload = JSON.parse(entities.body) as { entities: Array<{ id: string; name: string }> };
    assert.equal(payload.entities[0]?.name, '<script>alert(1)</script>');
    assert.equal(entities.headers['content-type'], 'application/json; charset=utf-8');

    for (const path of ['/../.env', '/%2e%2e/.env', '/package.json', '/src/main.ts', '/unknown.js']) {
      const response = await get(address.port, path);
      assert.equal(response.status, 404, `unexpected static path served: ${path}`);
    }
    const font = await get(address.port, '/fonts/geist-sans.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers['content-type'], 'font/woff2');
    assert.ok(Number(font.headers['content-length']) > 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('bundled typefaces retain their redistributable font license', async () => {
  const license = await readFile('public/fonts/LICENSE.txt', 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /Vercel/);
});
