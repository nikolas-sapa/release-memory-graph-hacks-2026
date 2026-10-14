import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { FalkorDB } from 'falkordb';
import type { Graph } from 'falkordb';
import type { FactEdge, IntentKey, NodeType, RelationType, SemanticRecord } from '../contracts.js';
import type { EvidenceReport, GraphStoreConfig } from '../contracts.js';
import { DEFAULT_GRAPH_NAME } from '../config.js';
import { EDGES_QUERY, projectEvidence, RECORDS_QUERY, SOURCE_QUERY } from './queries.js';

const nodeTypes = new Set<NodeType>(['Person', 'Project', 'Service', 'Ticket', 'Document', 'Decision']);
const relationTypes = new Set<RelationType>(['OWNS', 'USES', 'DEPENDS_ON', 'AFFECTS', 'ABOUT', 'CITES', 'SUPERSEDES', 'REVISES']);
const intents = new Set<IntentKey>(['impact', 'prerequisites', 'owners', 'current_rationale', 'history']);

export class GraphStoreError extends Error {
  constructor(readonly code: 'graph_unavailable' | 'unknown_target' | 'unsupported_intent' | 'incomplete_evidence' | 'integrity_failure', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GraphStoreError';
  }
}

/**
 * FalkorDB 6.8 forwards Redis errors to its wrapper before `connect()` returns.
 * During that narrow startup window the wrapper has no caller-installed error
 * listener, so a socket-close error becomes an uncaught exception. Contain
 * only that known client error and fail closed; preserve normal fatal behavior
 * for unrelated uncaught exceptions.
 */
export async function connectFalkorDBSafely(connect: () => Promise<FalkorDB>): Promise<FalkorDB> {
  let failStartup!: (error: GraphStoreError) => void;
  const startupSocketError = new Promise<never>((_, reject) => { failStartup = reject; });
  const onUncaughtException = (error: Error): void => {
    if (error?.name === 'SocketClosedUnexpectedlyError') {
      failStartup(new GraphStoreError('graph_unavailable', 'Graph socket closed during client initialization', { cause: error }));
      return;
    }
    process.removeListener('uncaughtException', onUncaughtException);
    setImmediate(() => { throw error; });
  };
  process.on('uncaughtException', onUncaughtException);
  try {
    return await Promise.race([connect(), startupSocketError]);
  } finally {
    process.removeListener('uncaughtException', onUncaughtException);
  }
}

export interface RetrievalBounds {
  depth?: number;
  pathCap?: number;
}

interface NodeRow {
  labels: string[];
  properties: Record<string, unknown>;
}

interface EdgeRow {
  sourceProperties: Record<string, unknown>;
  targetProperties: Record<string, unknown>;
  type: string;
  properties: Record<string, unknown>;
}

interface SourceRow {
  document: Record<string, unknown>;
}

function recordFromRow(row: NodeRow): SemanticRecord {
  const type = row.labels[0];
  const record = row.properties;
  if (!type || !nodeTypes.has(type as NodeType) || record.type !== type || typeof record.semantic_id !== 'string') {
    throw new GraphStoreError('integrity_failure', 'Graph returned a node with invalid label or canonical identity');
  }
  return record as SemanticRecord;
}

function edgeFromRow(row: EdgeRow): FactEdge {
  const edge = row.properties;
  if (!relationTypes.has(row.type as RelationType) || edge.type !== row.type || typeof edge.relationship_id !== 'string'
    || typeof row.sourceProperties.semantic_id !== 'string' || typeof row.targetProperties.semantic_id !== 'string'
    || edge.source_id_endpoint !== row.sourceProperties.semantic_id || edge.target_id !== row.targetProperties.semantic_id) {
    throw new GraphStoreError('integrity_failure', 'Graph returned an edge with invalid type, endpoints, or canonical identity');
  }
  return edge as unknown as FactEdge;
}

export class GraphStore {
  private readonly db: FalkorDB;
  private readonly graph: Graph;
  private readonly timeoutMs: number;
  private readonly sourcesByRequest = new Map<string, EvidenceReport['sources']>();
  private readonly recentRequestIds: string[] = [];

  private constructor(db: FalkorDB, graph: Graph, timeoutMs: number) {
    this.db = db;
    this.graph = graph;
    this.timeoutMs = timeoutMs;
    this.db.on('error', () => {});
  }

  static async connect(config: GraphStoreConfig): Promise<GraphStore> {
    const url = new URL(config.url);
    if (url.protocol !== 'redis:' || url.hostname !== '127.0.0.1' || url.port !== '6379' || url.username || url.password) {
      throw new GraphStoreError('graph_unavailable', 'Graph service must use the configured loopback endpoint');
    }
    const graphName = config.graphName ?? DEFAULT_GRAPH_NAME;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(graphName)) throw new GraphStoreError('graph_unavailable', 'Graph name is invalid');
    const timeoutMs = config.timeoutMs ?? 2000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw new GraphStoreError('graph_unavailable', 'Graph timeout must be between 1 and 2000 milliseconds');
    let db: FalkorDB;
    try {
      const options = { url: config.url, socket: { connectTimeout: timeoutMs, reconnectStrategy: false }, disableOfflineQueue: true } as unknown as Parameters<typeof FalkorDB.connect>[0];
      db = await connectFalkorDBSafely(() => FalkorDB.connect(options));
    } catch (error) {
      throw new GraphStoreError('graph_unavailable', 'Graph connection failed', { cause: error });
    }
    return new GraphStore(db, db.selectGraph(graphName), timeoutMs);
  }

  async inspect(targetId: string, intent: IntentKey, bounds: RetrievalBounds = {}): Promise<EvidenceReport> {
    if (!intents.has(intent)) throw new GraphStoreError('unsupported_intent', 'Unsupported retrieval intent');
    const depth = bounds.depth ?? 6;
    const pathCap = bounds.pathCap ?? 100;
    if (!Number.isInteger(depth) || depth < 0 || depth > 6 || !Number.isInteger(pathCap) || pathCap < 1 || pathCap > 100) {
      throw new GraphStoreError('incomplete_evidence', 'Retrieval bounds exceed the supported limit');
    }
    try {
      const [nodeResult, edgeResult] = await Promise.all([
        this.graph.roQuery<NodeRow>(RECORDS_QUERY, { TIMEOUT: this.timeoutMs }),
        this.graph.roQuery<EdgeRow>(EDGES_QUERY, { TIMEOUT: this.timeoutMs }),
      ]);
      const records = (nodeResult.data ?? []).map(recordFromRow);
      const edges = (edgeResult.data ?? []).map(edgeFromRow);
      const services = new Set(records.filter((record) => record.type === 'Service').map((record) => record.semantic_id));
      if (!services.has(targetId)) throw new GraphStoreError('unknown_target', 'Unknown service ID');
      const report = projectEvidence({ requestId: randomUUID(), targetId, intent, records, edges, depth, pathCap });
      this.sourcesByRequest.set(report.requestId, report.sources);
      this.recentRequestIds.push(report.requestId);
      if (this.recentRequestIds.length > 500) {
        const expired = this.recentRequestIds.shift();
        if (expired) this.sourcesByRequest.delete(expired);
      }
      return report;
    } catch (error) {
      if (error instanceof GraphStoreError) throw error;
      throw new GraphStoreError('graph_unavailable', 'Graph retrieval failed', { cause: error });
    }
  }

  async source(requestId: string, revisionId: string, anchor: string): Promise<EvidenceReport['sources'][number]> {
    const sources = this.sourcesByRequest.get(requestId);
    const expected = sources?.find((item) => item.revisionId === revisionId && item.anchor === anchor);
    if (!expected) throw new GraphStoreError('integrity_failure', 'Source reference is not part of this retrieval request');
    try {
      const result = await this.graph.roQuery<SourceRow>(SOURCE_QUERY, { params: { revisionId }, TIMEOUT: this.timeoutMs });
      const row = result.data?.[0];
      if (!row || result.data?.length !== 1) throw new GraphStoreError('integrity_failure', 'Immutable source revision is missing or duplicated');
      const document = row.document;
      if (document.semantic_id !== expected.revisionId || document.source_id !== expected.sourceId
        || document.revision_identity !== expected.revisionIdentity || document.content_digest !== expected.contentDigest
        || typeof document.content !== 'string'
        || createHash('sha256').update(document.content).digest('hex') !== expected.contentDigest) {
        throw new GraphStoreError('integrity_failure', 'Immutable source identity or content changed');
      }
      if (!document.content.includes(expected.excerpt) || !expected.excerpt.includes(anchor)) {
        throw new GraphStoreError('integrity_failure', 'Source anchor no longer matches the reviewed evidence');
      }
      return expected;
    } catch (error) {
      if (error instanceof GraphStoreError) throw error;
      throw new GraphStoreError('graph_unavailable', 'Source lookup failed', { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

