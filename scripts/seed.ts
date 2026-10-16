import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { FalkorDB } from 'falkordb';
import { connectFalkorDBSafely } from '../src/graph/store.js';
import { generateFixture, GENERATOR_VERSION, SEED } from '../fixtures/generate.js';
import { readConfig } from '../src/config.js';
import type { FactEdge, SemanticRecord } from '../src/contracts.js';

const BATCH_SIZE = 100;
const SEED_VERSION = `${GENERATOR_VERSION}:${SEED}`;
const NODE_TYPES = ['Person', 'Project', 'Service', 'Ticket', 'Document', 'Decision'] as const;
const EDGE_TYPES = ['OWNS', 'USES', 'DEPENDS_ON', 'AFFECTS', 'ABOUT', 'CITES', 'SUPERSEDES', 'REVISES'] as const;

async function main(): Promise<void> {
  const fixture = generateFixture();
  const config = readConfig();
  const attemptId = randomUUID();
  const seedBatch = (items: Array<SemanticRecord | FactEdge>): Array<SemanticRecord | FactEdge> =>
    items.map((item) => ({ ...item, fixture_seed_attempt: attemptId }));
  const db = await connectFalkorDBSafely(() => FalkorDB.connect({
    url: config.url,
    socket: { connectTimeout: config.timeoutMs, reconnectStrategy: false },
    disableOfflineQueue: true,
  } as unknown as Parameters<typeof FalkorDB.connect>[0]));
  db.on('error', () => {});
  const graph = db.selectGraph(config.graphName ?? 'release_memory');
  let writesStarted = false;

  try {
    const actual = await readSnapshot(graph);
    if (actual.records.length > 0 || actual.edges.length > 0) {
      assert.equal(actual.records.length, fixture.records.length, 'populated graph has unexpected node count');
      assert.equal(actual.edges.length, fixture.edges.length, 'populated graph has unexpected edge count');
      assert.equal(snapshotDigest(actual.records, actual.edges), snapshotDigest(fixture.records, fixture.edges),
        'populated graph differs from the selected synthetic fixture');
      process.stdout.write(`Verified existing synthetic graph ${config.graphName}; no writes made.\n`);
      return;
    }

    writesStarted = true;
    for (const type of NODE_TYPES) {
      const records = fixture.records.filter((record) => record.type === type);
      for (const batch of chunks(records, BATCH_SIZE)) {
        const markedBatch = seedBatch(batch);
        const result = await graph.query<{ created: number }>(
          `UNWIND $items AS item CREATE (node:${type}) SET node=item, node.fixture_seed_version=$version RETURN count(node) AS created`,
          { params: { items: markedBatch, version: SEED_VERSION }, TIMEOUT: config.timeoutMs },
        );
        assert.equal(result.data?.[0]?.created, batch.length, `${type} node batch was incomplete`);
      }
    }

    for (const type of EDGE_TYPES) {
      const edges = fixture.edges.filter((edge) => edge.type === type);
      for (const batch of chunks(edges, BATCH_SIZE)) {
        const markedBatch = seedBatch(batch);
        const result = await graph.query<{ created: number }>(
          `UNWIND $items AS item MATCH (source {semantic_id:item.source_id_endpoint}), (target {semantic_id:item.target_id})
           CREATE (source)-[edge:${type}]->(target) SET edge=item, edge.fixture_seed_version=$version RETURN count(edge) AS created`,
          { params: { items: markedBatch, version: SEED_VERSION }, TIMEOUT: config.timeoutMs },
        );
        assert.equal(result.data?.[0]?.created, batch.length, `${type} edge batch was incomplete`);
      }
    }

    const seeded = await readSnapshot(graph);
    assert.equal(seeded.records.length, 1000, 'seeded node count');
    assert.equal(seeded.edges.length, 3000, 'seeded edge count');
    assert.equal(snapshotDigest(seeded.records, seeded.edges), snapshotDigest(fixture.records, fixture.edges),
      'seeded graph differs from the selected synthetic fixture');
    process.stdout.write(`Seeded ${config.graphName} with ${seeded.records.length} synthetic nodes and ${seeded.edges.length} edges (${SEED_VERSION}).\n`);
  } catch (error) {
    if (writesStarted) {
      try {
        await graph.query('MATCH ()-[edge]->() WHERE edge.fixture_seed_attempt=$attemptId DELETE edge', {
          params: { attemptId }, TIMEOUT: config.timeoutMs,
        });
        await graph.query('MATCH (node) WHERE node.fixture_seed_attempt=$attemptId DELETE node', {
          params: { attemptId }, TIMEOUT: config.timeoutMs,
        });
      } catch {
        const cleanupError = new Error('Synthetic graph seeding failed and exact-attempt cleanup failed');
        Object.assign(cleanupError, { code: 'seed_cleanup_failed', cause: error });
        throw cleanupError;
      }
    }
    throw error;
  } finally {
    await db.close();
  }
}

async function readSnapshot(graph: ReturnType<FalkorDB['selectGraph']>): Promise<{ records: SemanticRecord[]; edges: FactEdge[] }> {
  const [records, edges] = await Promise.all([
    graph.query<{ record: SemanticRecord }>('MATCH (node) RETURN properties(node) AS record ORDER BY node.semantic_id', { TIMEOUT: 2000 }),
    graph.query<{ edge: FactEdge }>('MATCH ()-[edge]->() RETURN properties(edge) AS edge ORDER BY edge.relationship_id', { TIMEOUT: 2000 }),
  ]);
  return {
    records: (records.data ?? []).map((row) => withoutSeedMarker(row.record)),
    edges: (edges.data ?? []).map((row) => withoutSeedMarker(row.edge)),
  };
}

function withoutSeedMarker<T extends Record<string, unknown>>(value: T): T {
  const { fixture_seed_version: _version, fixture_seed_attempt: _attempt, ...rest } = value;
  return rest as T;
}

function snapshotDigest(records: Array<SemanticRecord | Record<string, unknown>>, edges: Array<FactEdge | Record<string, unknown>>): string {
  const canonical = (values: Array<SemanticRecord | FactEdge | Record<string, unknown>>, key: 'semantic_id' | 'relationship_id'): string =>
    JSON.stringify(values.map((value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null)
      .sort(([left], [right]) => left.localeCompare(right))))
      .sort((left, right) => String(left[key]).localeCompare(String(right[key]))));
  return createHash('sha256').update(JSON.stringify({ records: canonical(records, 'semantic_id'), edges: canonical(edges, 'relationship_id') })).digest('hex');
}

function* chunks<T>(values: T[], size: number): Generator<T[]> {
  for (let index = 0; index < values.length; index += size) yield values.slice(index, index + size);
}

void main().catch((error: unknown) => {
  process.stderr.write(`Synthetic graph seed failed safely: ${safeErrorCode(error)}\n`);
  process.exitCode = 1;
});

function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && /^[A-Za-z0-9_]{1,64}$/.test(error.code)) return error.code;
  if (error instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(error.name)) return error.name;
  return 'unknown_error';
}
