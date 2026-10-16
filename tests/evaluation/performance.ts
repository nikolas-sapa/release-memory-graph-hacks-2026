import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { FalkorDB } from 'falkordb';
import type { Graph } from 'falkordb';
import { generateFixture } from '../../fixtures/generate.js';
import { DEFAULT_GRAPH_NAME } from '../../src/config.js';
import { readConfig } from '../../src/config.js';
import { connectFalkorDBSafely, GraphStore, GraphStoreError, type RetrievalBounds } from '../../src/graph/store.js';
import type { EvidenceReport, IntentKey } from '../../src/contracts.js';

const WARMUPS_PER_QUERY = 1;
const MEASURED_REPETITIONS = 5;
const REQUIRED_MEASURED_SAMPLES = 100;
const P95_NEAREST_RANK = 95;
const LATENCY_LIMIT_MS = 1000;
const GRAPH_QUERY_TIMEOUT_MS = 2000;
const CLIENT_ATTEMPT_TIMEOUT_MS = 5000;
const NODE_COUNT_TARGET = 1000;
const EDGE_COUNT_TARGET = 3000;
const ALLOWED_INTENTS = new Set<IntentKey>(['impact', 'prerequisites', 'owners', 'current_rationale', 'history']);

interface BenchmarkQuery {
  id: string;
  targetId: string;
  intent: IntentKey;
  depth: number;
  pathCap: number;
  scenario: string;
}

interface QueryCatalog {
  id: string;
  revision: number;
  description: string;
  queries: BenchmarkQuery[];
}

interface CountRow {
  count: number | string;
}

interface NodeRow {
  labels: string[];
  properties: Record<string, unknown>;
}

interface EdgeRow {
  sourceLabels: string[];
  sourceProperties: Record<string, unknown>;
  type: string;
  properties: Record<string, unknown>;
  targetLabels: string[];
  targetProperties: Record<string, unknown>;
}

interface GraphSnapshot {
  format: 'graph-hacks-t06-graph-snapshot-v1';
  graphName: string;
  nodes: NodeRow[];
  edges: EdgeRow[];
}

interface PhysicalCounts {
  nodes: number;
  edges: number;
}

interface AttemptRow {
  query_id: string;
  target_id: string;
  intent: IntentKey;
  phase: 'warmup' | 'measured';
  repetition: number;
  started_at: string;
  duration_ms: number;
  execution_outcome: 'returned' | 'error' | 'timeout';
  evidence_status: EvidenceReport['status'] | '';
  path_count: number | '';
  edge_count: number | '';
  error_code: string;
}

interface AttemptResult {
  row: AttemptRow;
  report: EvidenceReport | null;
}

interface SnapshotCapture {
  countsBefore: PhysicalCounts;
  countsAfter: PhysicalCounts;
  snapshot: GraphSnapshot;
  snapshotBytes: Buffer;
  snapshotSha256: string;
  serverVersions: {
    redisCompatibilityVersion: string | null;
    modules: Array<{ name: string; versionCode: string }>;
  };
}

interface ContainerImageMetadata {
  composeConfigSha256: string;
  imageReference: string | null;
  imageDigest: string | null;
}

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const queryFile = fileURLToPath(new URL('./queries.json', import.meta.url));
const oracleFile = path.join(projectRoot, 'fixtures', 'oracle-ledger.md');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function sortRows<T>(rows: T[], identity: (row: T) => string): T[] {
  return rows.map((row) => canonicalValue(row) as T)
    .sort((left, right) => identity(left).localeCompare(identity(right))
      || JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function infoLines(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(infoLines);
  return [];
}

function infoField(lines: string[], key: string): string | null {
  const match = lines.map((line) => line.match(new RegExp(`^${key}:(.*)$`, 'i'))).find(Boolean);
  return match?.[1]?.trim() || null;
}

function readRedisInfo(url: string): Promise<string> {
  const endpoint = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });
    let response = Buffer.alloc(0);
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(GRAPH_QUERY_TIMEOUT_MS, () => fail(Object.assign(new Error('redis_info_timeout'), { code: 'redis_info_timeout' })));
    socket.once('connect', () => socket.write('*1\r\n$4\r\nINFO\r\n'));
    socket.on('data', (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      const headerEnd = response.indexOf('\r\n');
      if (headerEnd < 0) return;
      const length = Number(response.toString('ascii', 1, headerEnd));
      if (response[0] !== '$'.charCodeAt(0) || !Number.isSafeInteger(length) || length < 0) {
        fail(Object.assign(new Error('redis_info_protocol_error'), { code: 'redis_info_protocol_error' }));
        return;
      }
      const bodyStart = headerEnd + 2;
      const responseEnd = bodyStart + length + 2;
      if (response.length < responseEnd) return;
      if (response.toString('ascii', responseEnd - 2, responseEnd) !== '\r\n') {
        fail(Object.assign(new Error('redis_info_protocol_error'), { code: 'redis_info_protocol_error' }));
        return;
      }
      settled = true;
      socket.destroy();
      resolve(response.toString('utf8', bodyStart, bodyStart + length));
    });
    socket.once('error', fail);
    socket.once('close', () => {
      if (!settled) fail(Object.assign(new Error('redis_info_connection_closed'), { code: 'redis_info_connection_closed' }));
    });
  });
}

function moduleVersions(lines: string[]): Array<{ name: string; versionCode: string }> {
  return lines.flatMap((line) => {
    const name = line.match(/(?:^|[,:\s])name=([^,\s]+)/i)?.[1];
    const versionCode = line.match(/(?:^|[,:\s])ver=([^,\s]+)/i)?.[1];
    return name && versionCode ? [{ name, versionCode }] : [];
  }).sort((left, right) => left.name.localeCompare(right.name) || left.versionCode.localeCompare(right.versionCode));
}

function parseContainerImageMetadata(composeBytes: Buffer): ContainerImageMetadata {
  const composeText = composeBytes.toString('utf8');
  const imageLines = [...composeText.matchAll(/^\s+image:\s*([^\s#]+)\s*$/gm)];
  const imageReference = imageLines.length === 1 ? imageLines[0]?.[1] ?? null : null;
  const imageDigest = imageReference?.match(/@sha256:([a-f0-9]{64})$/i)?.[1] ?? null;
  return { composeConfigSha256: sha256(composeBytes), imageReference, imageDigest };
}

function numericCount(rows: CountRow[] | undefined, label: string): number {
  const count = Number(rows?.[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`FalkorDB ${label} count query returned an invalid value`);
  return count;
}

async function readCounts(graph: Graph): Promise<PhysicalCounts> {
  const [nodeResult, edgeResult] = await Promise.all([
    graph.roQuery<CountRow>('MATCH (n) RETURN count(n) AS count', { TIMEOUT: GRAPH_QUERY_TIMEOUT_MS }),
    graph.roQuery<CountRow>('MATCH ()-[r]->() RETURN count(r) AS count', { TIMEOUT: GRAPH_QUERY_TIMEOUT_MS }),
  ]);
  return {
    nodes: numericCount(nodeResult.data, 'physical node'),
    edges: numericCount(edgeResult.data, 'physical edge'),
  };
}

async function captureSnapshot(graphName: string, url: string): Promise<SnapshotCapture> {
  const options = {
    url,
    socket: { connectTimeout: GRAPH_QUERY_TIMEOUT_MS, reconnectStrategy: false },
    disableOfflineQueue: true,
  } as unknown as Parameters<typeof FalkorDB.connect>[0];
  const db = await connectFalkorDBSafely(() => FalkorDB.connect(options));
  db.on('error', () => {});
  try {
    const graph = db.selectGraph(graphName);
    const countsBefore = await readCounts(graph);
    const [nodeResult, edgeResult] = await Promise.all([
      graph.roQuery<NodeRow>('MATCH (n) RETURN labels(n) AS labels, properties(n) AS properties', { TIMEOUT: GRAPH_QUERY_TIMEOUT_MS }),
      graph.roQuery<EdgeRow>('MATCH (a)-[r]->(b) RETURN labels(a) AS sourceLabels, properties(a) AS sourceProperties, type(r) AS type, properties(r) AS properties, labels(b) AS targetLabels, properties(b) AS targetProperties', { TIMEOUT: GRAPH_QUERY_TIMEOUT_MS }),
    ]);
    const nodes = sortRows(nodeResult.data ?? [], (row) => String(row.properties.semantic_id ?? ''));
    const edges = sortRows(edgeResult.data ?? [], (row) => String(row.properties.relationship_id ?? ''));
    const countsAfter = await readCounts(graph);
    const snapshot = normalizeSnapshot({ format: 'graph-hacks-t06-graph-snapshot-v1', graphName, nodes, edges });
    const snapshotBytes = Buffer.from(canonicalJson(snapshot));
    const serverInfo = infoLines(await readRedisInfo(url));
    const modules = serverInfo.filter((line) => /^module:/i.test(line));
    return {
      countsBefore,
      countsAfter,
      snapshot,
      snapshotBytes,
      snapshotSha256: sha256(snapshotBytes),
      serverVersions: {
        redisCompatibilityVersion: infoField(serverInfo, 'redis_version'),
        modules: moduleVersions(modules),
      },
    };
  } finally {
    await db.close();
  }
}

function validateCatalog(catalog: QueryCatalog): void {
  if (catalog.id !== 't06-graphstore-inspect-v1' || catalog.revision !== 1 || !Array.isArray(catalog.queries)
    || catalog.queries.length !== 20) throw new Error('Frozen query catalog must contain exactly 20 T06 queries');
  const ids = new Set<string>();
  const inputs = new Set<string>();
  catalog.queries.forEach((query, index) => {
    const expectedId = `T06-${String(index + 1).padStart(2, '0')}`;
    if (query.id !== expectedId || ids.has(query.id)) throw new Error(`Frozen query catalog ID mismatch at ${expectedId}`);
    if (!/^service:\d{3}$/.test(query.targetId) || !ALLOWED_INTENTS.has(query.intent)) throw new Error(`${query.id} has invalid inspect input`);
    if (!Number.isInteger(query.depth) || query.depth < 0 || query.depth > 6
      || !Number.isInteger(query.pathCap) || query.pathCap < 1 || query.pathCap > 100) {
      throw new Error(`${query.id} has invalid retrieval bounds`);
    }
    if (!query.scenario.trim()) throw new Error(`${query.id} needs a scenario label`);
    const signature = `${query.targetId}\u0000${query.intent}\u0000${query.depth}\u0000${query.pathCap}`;
    if (inputs.has(signature)) throw new Error(`${query.id} duplicates an earlier GraphStore.inspect input`);
    ids.add(query.id);
    inputs.add(signature);
  });
}

async function writeFrozenFile(filePath: string, bytes: Uint8Array): Promise<void> {
  await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  const saved = await readFile(filePath);
  if (sha256(saved) !== sha256(bytes)) throw new Error(`Frozen input verification failed: ${path.basename(filePath)}`);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof GraphStoreError) return error.code;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.name : 'unknown_error';
}

function isTimeoutError(error: unknown): boolean {
  let cursor: unknown = error;
  const visited = new Set<unknown>();
  while (cursor && typeof cursor === 'object' && !visited.has(cursor)) {
    visited.add(cursor);
    const item = cursor as { name?: unknown; message?: unknown; cause?: unknown };
    const text = `${String(item.name ?? '')} ${String(item.message ?? '')}`;
    if (/timeout|timed out|deadline exceeded/i.test(text)) return true;
    cursor = item.cause;
  }
  return false;
}

async function runAttempt(
  store: GraphStore,
  query: BenchmarkQuery,
  phase: AttemptRow['phase'],
  repetition: number,
): Promise<AttemptResult> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const request = store.inspect(query.targetId, query.intent, { depth: query.depth, pathCap: query.pathCap } satisfies RetrievalBounds);
  const settled = request.then(
    (report) => ({ kind: 'report' as const, report }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  );
  const timed = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), CLIENT_ATTEMPT_TIMEOUT_MS);
  });
  const result = await Promise.race([settled, timed]);
  if (timer) clearTimeout(timer);
  const durationMs = Number((performance.now() - started).toFixed(3));
  const base = {
    query_id: query.id,
    target_id: query.targetId,
    intent: query.intent,
    phase,
    repetition,
    started_at: startedAt,
    duration_ms: durationMs,
  };
  if (result.kind === 'timeout') {
    void settled.catch(() => {});
    return { report: null, row: { ...base, execution_outcome: 'timeout', evidence_status: '', path_count: '', edge_count: '', error_code: 'client_attempt_timeout' } };
  }
  if (result.kind === 'error') {
    const timeout = isTimeoutError(result.error);
    return { report: null, row: { ...base, execution_outcome: timeout ? 'timeout' : 'error', evidence_status: '', path_count: '', edge_count: '', error_code: safeErrorCode(result.error) } };
  }
  return {
    report: result.report,
    row: {
      ...base,
      execution_outcome: 'returned',
      evidence_status: result.report.status,
      path_count: result.report.paths.length,
      edge_count: result.report.edges.length,
      error_code: '',
    },
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function attemptsCsv(rows: AttemptRow[]): string {
  const columns: Array<keyof AttemptRow> = [
    'query_id', 'target_id', 'intent', 'phase', 'repetition', 'started_at', 'duration_ms',
    'execution_outcome', 'evidence_status', 'path_count', 'edge_count', 'error_code',
  ];
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

function collectServiceIds(snapshot: GraphSnapshot): Set<string> {
  return new Set(snapshot.nodes.filter((row) => row.labels.includes('Service') && row.properties.type === 'Service')
    .map((row) => String(row.properties.semantic_id)));
}

function withoutSeedMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    item !== null && key !== 'fixture_seed_version' && key !== 'fixture_seed_attempt'));
}

function normalizeSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  return {
    ...snapshot,
    nodes: sortRows(snapshot.nodes.map((row) => ({ ...row, properties: withoutSeedMetadata(row.properties) })),
      (row) => String(row.properties.semantic_id ?? '')),
    edges: sortRows(snapshot.edges.map((row) => ({
      ...row,
      sourceProperties: withoutSeedMetadata(row.sourceProperties),
      properties: withoutSeedMetadata(row.properties),
      targetProperties: withoutSeedMetadata(row.targetProperties),
    })), (row) => String(row.properties.relationship_id ?? '')),
  };
}

function generatedFixtureSnapshot(graphName: string): GraphSnapshot {
  const fixture = generateFixture();
  const recordsById = new Map(fixture.records.map((record) => [record.semantic_id, record]));
  const nodes = sortRows(fixture.records.map((record) => ({
    labels: [record.type],
    properties: withoutSeedMetadata(record as unknown as Record<string, unknown>),
  })), (row) => String(row.properties.semantic_id ?? ''));
  const edges = sortRows(fixture.edges.map((edge) => {
    const source = recordsById.get(edge.source_id_endpoint);
    const target = recordsById.get(edge.target_id);
    if (!source || !target) throw new Error('Generated fixture contains an edge with a missing endpoint');
    return {
      sourceLabels: [source.type],
      sourceProperties: withoutSeedMetadata(source as unknown as Record<string, unknown>),
      type: edge.type,
      properties: withoutSeedMetadata(edge as unknown as Record<string, unknown>),
      targetLabels: [target.type],
      targetProperties: withoutSeedMetadata(target as unknown as Record<string, unknown>),
    };
  }), (row) => String(row.properties.relationship_id ?? ''));
  return { format: 'graph-hacks-t06-graph-snapshot-v1', graphName, nodes, edges };
}

function environmentMetadata(input: {
  runId: string;
  evaluationId: string;
  graphName: string;
  graphCounts: PhysicalCounts;
  datasetDigest: string;
  oracleDigest: string;
  queryDigest: string;
  serverVersions: SnapshotCapture['serverVersions'];
  containerImage: ContainerImageMetadata;
  clientVersion: string;
  startedAt: string;
}): Record<string, unknown> {
  const cpu = os.cpus()[0];
  return {
    runId: input.runId,
    evaluationId: input.evaluationId,
    startedAt: input.startedAt,
    os: { platform: process.platform, release: os.release(), architecture: process.arch },
    cpu: { model: cpu?.model ?? null, logicalCores: os.cpus().length },
    memoryBytes: os.totalmem(),
    runtime: { node: process.version, falkordbClient: input.clientVersion },
    serverVersions: input.serverVersions,
    containerImage: input.containerImage,
    graph: {
      name: input.graphName,
      physicalNodes: input.graphCounts.nodes,
      physicalEdges: input.graphCounts.edges,
      expectedPhysicalNodes: NODE_COUNT_TARGET,
      expectedPhysicalEdges: EDGE_COUNT_TARGET,
      persistenceVolumeIdentity: 'unverified by this read-only runner',
      persistenceSettings: 'unverified by this read-only runner',
      exclusiveWriterBoundary: 'unverified',
      lineageTopology: 'unassessed; physical counts do not establish lineage correctness',
    },
    frozenInputs: {
      datasetSnapshotSha256: input.datasetDigest,
      oracleSha256: input.oracleDigest,
      queryCatalogSha256: input.queryDigest,
    },
    benchmark: {
      queryMethod: 'GraphStore.inspect',
      warmupsPerQuery: WARMUPS_PER_QUERY,
      measuredRepetitionsPerQuery: MEASURED_REPETITIONS,
      requiredMeasuredSamples: REQUIRED_MEASURED_SAMPLES,
      serverQueryTimeoutMs: GRAPH_QUERY_TIMEOUT_MS,
      clientAttemptTimeoutMs: CLIENT_ATTEMPT_TIMEOUT_MS,
      latencyThresholdMsExclusive: LATENCY_LIMIT_MS,
      modelCalls: 0,
      graphWrites: 0,
    },
  };
}

async function main(): Promise<void> {
  const runId = `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
  const runDirectory = path.join(projectRoot, 'work', 'evaluation', 'runs', runId);
  const frozenDirectory = path.join(runDirectory, 'frozen');
  await mkdir(frozenDirectory, { recursive: true, mode: 0o700 });

  const config = readConfig();
  const graphName = config.graphName ?? DEFAULT_GRAPH_NAME;
  const queryBytes = await readFile(queryFile);
  const oracleBytes = await readFile(oracleFile);
  const composeBytes = await readFile(path.join(projectRoot, 'compose.yaml'));
  const containerImage = parseContainerImageMetadata(composeBytes);
  const catalog = JSON.parse(queryBytes.toString('utf8')) as QueryCatalog;
  validateCatalog(catalog);
  const expectedFixture = generatedFixtureSnapshot(graphName);
  const expectedFixtureBytes = Buffer.from(canonicalJson(expectedFixture));
  const expectedFixtureDigest = sha256(expectedFixtureBytes);

  const attempts: AttemptRow[] = [];
  const startedAt = new Date().toISOString();
  let finalStatus: 'passed' | 'failed' | 'blocked' = 'blocked';
  let preflightReason = '';
  let graphMatchesFixture: boolean | null = null;
  let snapshotBefore: SnapshotCapture | null = null;
  let snapshotAfter: SnapshotCapture | null = null;
  let postSnapshotError: string | null = null;
  let graphStore: GraphStore | null = null;
  let manifest: Record<string, unknown> | null = null;
  let environment: Record<string, unknown> | null = null;
  let evaluationId = `t06-unfrozen-${runId}`;
  let queryDigest = sha256(queryBytes);
  let oracleDigest = sha256(oracleBytes);

  try {
    snapshotBefore = await captureSnapshot(graphName, config.url);
    graphMatchesFixture = canonicalJson(normalizeSnapshot(snapshotBefore.snapshot)) === expectedFixtureBytes.toString('utf8');
    if (!graphMatchesFixture) {
      throw Object.assign(new Error('Configured local graph does not match the generated synthetic fixture'), {
        code: 'configured_graph_fixture_mismatch',
      });
    }
    await writeFrozenFile(path.join(frozenDirectory, 'dataset-snapshot.json'), snapshotBefore.snapshotBytes);
    await writeFrozenFile(path.join(frozenDirectory, 'expected-fixture.json'), expectedFixtureBytes);
    await writeFrozenFile(path.join(frozenDirectory, 'oracle-ledger.md'), oracleBytes);
    await writeFrozenFile(path.join(frozenDirectory, 'queries.json'), queryBytes);
    queryDigest = sha256(await readFile(path.join(frozenDirectory, 'queries.json')));
    oracleDigest = sha256(await readFile(path.join(frozenDirectory, 'oracle-ledger.md')));
    const datasetDigest = sha256(await readFile(path.join(frozenDirectory, 'dataset-snapshot.json')));
    evaluationId = `t06-${datasetDigest.slice(0, 12)}-${expectedFixtureDigest.slice(0, 12)}-${oracleDigest.slice(0, 12)}-${queryDigest.slice(0, 12)}`;
    manifest = {
      evaluationId,
      status: 'frozen-before-measurement',
      architecture: 'Option A baseline; physical topology is not assessed by this runner',
      frozenAt: new Date().toISOString(),
      inputs: [
        { id: `live-graph-${graphName}`, revision: 'captured-read-only-snapshot-v1', path: 'dataset-snapshot.json', bytes: snapshotBefore.snapshotBytes.length, sha256: datasetDigest },
        { id: 'f01-generated-fixture', revision: 'f01-v1', path: 'expected-fixture.json', bytes: expectedFixtureBytes.length, sha256: expectedFixtureDigest },
        { id: 'f01-oracle-ledger', revision: 'f01-v1', path: 'oracle-ledger.md', bytes: oracleBytes.length, sha256: oracleDigest, independentHumanReview: 'not recorded in source ledger' },
        { id: catalog.id, revision: String(catalog.revision), path: 'queries.json', bytes: queryBytes.length, sha256: queryDigest },
      ],
      seed: 20261008,
      generatorVersion: 'f01-v1',
      falkordbClientVersion: '6.8.0',
      falkordbServerVersions: snapshotBefore.serverVersions,
      containerImage,
      graphName,
      measuredRun: false,
    };
    const manifestBytes = Buffer.from(canonicalJson(manifest));
    await writeFrozenFile(path.join(frozenDirectory, 'manifest.json'), manifestBytes);

    const afterCountsStable = snapshotBefore.countsBefore.nodes === snapshotBefore.countsAfter.nodes
      && snapshotBefore.countsBefore.edges === snapshotBefore.countsAfter.edges;
    const snapshotMatchesCounts = snapshotBefore.snapshot.nodes.length === snapshotBefore.countsAfter.nodes
      && snapshotBefore.snapshot.edges.length === snapshotBefore.countsAfter.edges;
    const expectedCounts = snapshotBefore.countsAfter.nodes === NODE_COUNT_TARGET
      && snapshotBefore.countsAfter.edges === EDGE_COUNT_TARGET;
    const serviceIds = collectServiceIds(snapshotBefore.snapshot);
    const allTargetsPresent = catalog.queries.every((query) => serviceIds.has(query.targetId));
    if (!afterCountsStable || !snapshotMatchesCounts || !expectedCounts || !allTargetsPresent) {
      preflightReason = `Read-only baseline preflight failed (count-stable=${afterCountsStable}, snapshot-counts=${snapshotMatchesCounts}, exact-1000/3000=${expectedCounts}, targets-present=${allTargetsPresent}).`;
    } else {
      graphStore = await GraphStore.connect({ ...config, timeoutMs: GRAPH_QUERY_TIMEOUT_MS });
      let timeoutDetected = false;
      for (const query of catalog.queries) {
        const warmup = await runAttempt(graphStore, query, 'warmup', 0);
        attempts.push(warmup.row);
        if (warmup.row.execution_outcome === 'timeout') {
          timeoutDetected = true;
          break;
        }
        for (let repetition = 1; repetition <= MEASURED_REPETITIONS; repetition++) {
          const measured = await runAttempt(graphStore, query, 'measured', repetition);
          attempts.push(measured.row);
          if (measured.row.execution_outcome === 'timeout') {
            timeoutDetected = true;
            break;
          }
        }
        if (timeoutDetected) break;
      }
      await graphStore.close().catch(() => {});
      graphStore = null;
      try {
        snapshotAfter = await captureSnapshot(graphName, config.url);
      } catch (error) {
        postSnapshotError = safeErrorCode(error);
      }
      finalStatus = 'failed';
    }

    const measured = attempts.filter((row) => row.phase === 'measured');
    const latencies = measured.map((row) => row.duration_ms).sort((left, right) => left - right);
    const p95Ms = latencies.length === REQUIRED_MEASURED_SAMPLES ? latencies[P95_NEAREST_RANK - 1] ?? null : null;
    const executionErrors = attempts.filter((row) => row.execution_outcome === 'error').length;
    const timeouts = attempts.filter((row) => row.execution_outcome === 'timeout').length;
    const incompleteReports = attempts.filter((row) => row.evidence_status && row.evidence_status !== 'complete').length;
    const allAttemptsComplete = attempts.length === catalog.queries.length * (WARMUPS_PER_QUERY + MEASURED_REPETITIONS)
      && attempts.every((row) => row.execution_outcome === 'returned' && row.evidence_status === 'complete');
    const exactCounts = snapshotBefore.countsAfter.nodes === NODE_COUNT_TARGET && snapshotBefore.countsAfter.edges === EDGE_COUNT_TARGET;
    const snapshotUnchanged = snapshotAfter !== null && snapshotBefore.snapshotSha256 === snapshotAfter.snapshotSha256;
    const postCountsStable = snapshotAfter !== null
      && snapshotAfter.countsBefore.nodes === snapshotAfter.countsAfter.nodes
      && snapshotAfter.countsBefore.edges === snapshotAfter.countsAfter.edges
      && snapshotAfter.snapshot.nodes.length === snapshotAfter.countsAfter.nodes
      && snapshotAfter.snapshot.edges.length === snapshotAfter.countsAfter.edges;
    const postCountsExact = postCountsStable && snapshotAfter?.countsAfter.nodes === NODE_COUNT_TARGET
      && snapshotAfter?.countsAfter.edges === EDGE_COUNT_TARGET;
    const p95Pass = p95Ms !== null && p95Ms < LATENCY_LIMIT_MS;
    const measurementSetComplete = measured.length === REQUIRED_MEASURED_SAMPLES;
    if (measurementSetComplete && graphMatchesFixture === true && exactCounts && snapshotUnchanged && postCountsExact && p95Pass && allAttemptsComplete
      && executionErrors === 0 && timeouts === 0 && incompleteReports === 0) finalStatus = 'passed';
    else if (measurementSetComplete || attempts.length > 0) finalStatus = 'failed';

    const metadata = environmentMetadata({
      runId,
      evaluationId,
      graphName,
      graphCounts: snapshotBefore.countsAfter,
      datasetDigest: snapshotBefore.snapshotSha256,
      oracleDigest,
      queryDigest,
      serverVersions: snapshotBefore.serverVersions,
      containerImage,
      clientVersion: '6.8.0',
      startedAt,
    });
    environment = { ...metadata, configuredGraphMatchesGeneratedFixture: graphMatchesFixture, expectedFixtureSha256: expectedFixtureDigest, endedAt: new Date().toISOString() };
    await writeFile(path.join(runDirectory, 'environment.json'), canonicalJson(environment), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(runDirectory, 'latencies.csv'), attemptsCsv(attempts), { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(runDirectory, 'summary.json'), canonicalJson({
      evaluationId,
      runId,
      status: finalStatus,
      preflightReason: preflightReason || null,
      required: {
        distinctQueries: 20,
        warmupsPerQuery: WARMUPS_PER_QUERY,
        measuredRepetitionsPerQuery: MEASURED_REPETITIONS,
        measuredSamples: REQUIRED_MEASURED_SAMPLES,
        nearestRankP95Sample: P95_NEAREST_RANK,
        p95ThresholdMsExclusive: LATENCY_LIMIT_MS,
      },
      observed: {
        frozenDatasetSha256: snapshotBefore.snapshotSha256,
        oracleSha256: oracleDigest,
        queryCatalogSha256: queryDigest,
        expectedFixtureSha256: expectedFixtureDigest,
        configuredGraphMatchesGeneratedFixture: graphMatchesFixture,
        physicalNodeCount: snapshotBefore.countsAfter.nodes,
        physicalEdgeCount: snapshotBefore.countsAfter.edges,
        warmupAttempts: attempts.filter((row) => row.phase === 'warmup').length,
        measuredAttempts: measured.length,
        returnedMeasured: measured.filter((row) => row.execution_outcome === 'returned').length,
        executionErrors,
        timeouts,
        incompleteEvidenceReports: incompleteReports,
        nearestRankP95Ms: p95Ms,
        snapshotUnchangedAfterReadOnlyRun: snapshotUnchanged,
        physicalCountsExactBeforeAndAfter: exactCounts && postCountsExact,
        postSnapshotError,
        lineageTopology: 'not assessed; counts and snapshot hashes do not establish lineage correctness',
        t01ToT08AndE01ToE26Acceptance: 'not assessed by this benchmark',
      },
      gates: {
        exactPhysicalCounts: exactCounts && postCountsExact,
        configuredGraphMatchesGeneratedFixture: graphMatchesFixture === true,
        exactly100MeasuredSamples: measurementSetComplete,
        allAttemptsReturned: attempts.every((row) => row.execution_outcome === 'returned'),
        allAttemptEvidenceReportsComplete: allAttemptsComplete,
        zeroErrors: executionErrors === 0,
        zeroTimeouts: timeouts === 0,
        p95Below1000ms: p95Pass,
        graphSnapshotUnchanged: snapshotUnchanged,
        postSnapshotCountsStable: postCountsStable,
        overallT06: finalStatus,
      },
      artifacts: {
        environment: 'environment.json',
        latencies: 'latencies.csv',
        frozenInputs: 'frozen/',
      },
    }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (graphStore) await graphStore.close().catch(() => {});
    finalStatus = attempts.length > 0 ? 'failed' : 'blocked';
    preflightReason = `Benchmark setup or capture failed: ${safeErrorCode(error)}`;
    await writeFile(path.join(runDirectory, 'execution-error.json'), canonicalJson({
      runId,
      status: finalStatus,
      reason: preflightReason,
      startedAt,
      recordedAt: new Date().toISOString(),
      attemptsRetained: attempts.length,
    }), { flag: 'wx', mode: 0o600 }).catch(() => {});
    await writeFile(path.join(runDirectory, 'latencies.csv'), attemptsCsv(attempts), { flag: 'wx', mode: 0o600 }).catch(() => {});
    if (snapshotBefore) {
      const metadata = environmentMetadata({
        runId,
        evaluationId,
        graphName,
        graphCounts: snapshotBefore.countsAfter,
        datasetDigest: snapshotBefore.snapshotSha256,
        oracleDigest,
        queryDigest,
        serverVersions: snapshotBefore.serverVersions,
        containerImage,
        clientVersion: '6.8.0',
        startedAt,
      });
      await writeFile(path.join(runDirectory, 'environment.json'), canonicalJson({
        ...metadata,
        configuredGraphMatchesGeneratedFixture: graphMatchesFixture,
        expectedFixtureSha256: expectedFixtureDigest,
        endedAt: new Date().toISOString(),
      }), { flag: 'wx', mode: 0o600 }).catch(() => {});
      const measured = attempts.filter((row) => row.phase === 'measured');
      const latencies = measured.map((row) => row.duration_ms).sort((left, right) => left - right);
      await writeFile(path.join(runDirectory, 'summary.json'), canonicalJson({
        evaluationId,
        runId,
        status: finalStatus,
        preflightReason,
        required: { distinctQueries: 20, warmupsPerQuery: WARMUPS_PER_QUERY, measuredRepetitionsPerQuery: MEASURED_REPETITIONS, measuredSamples: REQUIRED_MEASURED_SAMPLES, nearestRankP95Sample: P95_NEAREST_RANK, p95ThresholdMsExclusive: LATENCY_LIMIT_MS },
        observed: {
          frozenDatasetSha256: snapshotBefore.snapshotSha256,
          oracleSha256: oracleDigest,
          queryCatalogSha256: queryDigest,
          expectedFixtureSha256: expectedFixtureDigest,
          configuredGraphMatchesGeneratedFixture: graphMatchesFixture,
          physicalNodeCount: snapshotBefore.countsAfter.nodes,
          physicalEdgeCount: snapshotBefore.countsAfter.edges,
          warmupAttempts: attempts.filter((row) => row.phase === 'warmup').length,
          measuredAttempts: measured.length,
          returnedMeasured: measured.filter((row) => row.execution_outcome === 'returned').length,
          executionErrors: attempts.filter((row) => row.execution_outcome === 'error').length,
          timeouts: attempts.filter((row) => row.execution_outcome === 'timeout').length,
          incompleteEvidenceReports: attempts.filter((row) => row.evidence_status && row.evidence_status !== 'complete').length,
          nearestRankP95Ms: measured.length === REQUIRED_MEASURED_SAMPLES ? latencies[P95_NEAREST_RANK - 1] ?? null : null,
          lineageTopology: 'not assessed; counts and snapshot hashes do not establish lineage correctness',
          t01ToT08AndE01ToE26Acceptance: 'not assessed by this benchmark',
        },
      }), { flag: 'wx', mode: 0o600 }).catch(() => {});
    }
  }

  const measuredAttempts = attempts.filter((row) => row.phase === 'measured');
  const sortedMeasured = measuredAttempts.map((row) => row.duration_ms).sort((left, right) => left - right);
  process.stdout.write(`${JSON.stringify({ status: finalStatus, runId, evaluationId, directory: path.relative(projectRoot, runDirectory), measuredAttempts: measuredAttempts.length, p95Ms: measuredAttempts.length === REQUIRED_MEASURED_SAMPLES ? sortedMeasured[P95_NEAREST_RANK - 1] : null, reason: preflightReason || undefined })}\n`);
  if (finalStatus !== 'passed') process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`T06 evaluation setup failed: ${safeErrorCode(error)}\n`);
  process.exitCode = 1;
});
