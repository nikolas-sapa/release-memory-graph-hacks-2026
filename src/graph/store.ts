import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { FalkorDB } from 'falkordb';
import type { Graph } from 'falkordb';
import type { FactEdge, IntentKey, NodeType, RelationType, SemanticRecord } from '../contracts.js';
import type { EvidenceReport, GraphStoreConfig } from '../contracts.js';
import { DEFAULT_GRAPH_NAME } from '../config.js';
import { EDGES_QUERY, projectEvidence, RECORDS_QUERY, SOURCE_QUERY } from './queries.js';
import { validateLineage } from './lineage.js';
import type { ReviewedCitation, ReviewSnapshot } from '../memory/review.js';
import type { AtomicCommitResult, PersistedReceipt, PersistableReviewIntent, ReceiptLookup } from '../memory/save.js';

const RECEIPT_QUERY = `MATCH (d:Decision {request_id:$requestId}) OPTIONAL MATCH (d)-[r]->(other)
  RETURN properties(d) AS decision, collect(CASE WHEN r IS NULL THEN null ELSE [type(r),properties(r),properties(other)] END) AS outgoing`;
const ATOMIC_REVIEW_QUERY = `
  MATCH (s:Service {semantic_id:$subjectId})
  OPTIONAL MATCH (a)-[r]->(b)
  WITH s,a,r,b ORDER BY r.relationship_id
  WITH s,collect(CASE WHEN r IS NULL THEN null ELSE [r.relationship_id,type(r),a.semantic_id,b.semantic_id,
    coalesce(r.source_id,''),coalesce(r.document_revision_id,''),coalesce(r.anchor,''),coalesce(r.asserted_at,''),
    coalesce(r.validity_state,''),coalesce(r.review_state,''),coalesce(r.acceptance_state,''),
    coalesce(r.reviewer_id,''),coalesce(r.reviewed_at,''),coalesce(r.ownership_mode,'')] END) AS actualMaterial
  WHERE actualMaterial=$materialInventory
  OPTIONAL MATCH (d:Decision {scope_subject_id:$subjectId,decision_key:$decisionKey,state:'accepted'})
  WITH s,actualMaterial,d ORDER BY d.semantic_id
  WITH s,actualMaterial,collect(CASE WHEN d IS NULL THEN null ELSE [d.semantic_id,coalesce(d.scope_subject_id,''),
    coalesce(d.decision_key,''),coalesce(d.state,''),coalesce(d.name,''),coalesce(d.text,''),coalesce(d.rationale,''),
    coalesce(d.expected_predecessor_id,''),coalesce(d.intent_digest,''),coalesce(d.request_id,''),
    coalesce(d.reviewer_id,''),coalesce(d.reviewed_at,''),coalesce(d.intent_json,'')] END) AS actualLineage
  WHERE actualLineage=$lineageInventory
  OPTIONAL MATCH (h:Decision {scope_subject_id:$subjectId,decision_key:$decisionKey,state:'accepted'})
  WHERE NOT (h)<-[:SUPERSEDES]-(:Decision {state:'accepted'})
  WITH s,actualMaterial,actualLineage,collect(h) AS heads
  WHERE ($predecessor IS NULL AND size(heads)=0)
    OR ($predecessor IS NOT NULL AND size(heads)=1 AND heads[0].semantic_id=$predecessor)
  OPTIONAL MATCH (existing:Decision {request_id:$requestId})
  WITH s,heads WHERE existing IS NULL
  UNWIND $citationBindings AS citation
  MATCH (doc:Document {semantic_id:citation[1]})
  WHERE doc.content_digest=citation[3]
  WITH s,heads,collect([citation,doc]) AS cited
  WHERE size(cited)=size($citationBindings)
  WITH s,heads,cited,cited[0][1] AS firstDoc
  CREATE (d:Decision {type:'Decision',semantic_id:$decisionId,name:$text,state:'accepted',scope_subject_id:$subjectId,
    decision_key:$decisionKey,text:$text,rationale:$rationale,reviewer_id:$reviewerId,reviewed_at:$reviewedAt,
    expected_predecessor_id:$predecessor,request_id:$requestId,intent_version:$intentVersion,
    intent_digest:$intentDigest,intent_json:$intentJson,citation_count:size(cited)})
  WITH d,s,heads,cited,firstDoc.source_id AS firstSourceId,firstDoc.semantic_id AS firstRevisionId,cited[0][0][2] AS firstAnchor,firstDoc
  CREATE (d)-[:ABOUT {type:'ABOUT',relationship_id:$aboutEdgeId,source_id_endpoint:$decisionId,target_id:$subjectId,
    source_id:firstDoc.source_id,document_revision_id:firstDoc.semantic_id,anchor:cited[0][0][2],asserted_at:$reviewedAt,
    validity_state:'current',review_state:'reviewed'}]->(s)
  WITH d,heads,cited,firstSourceId,firstRevisionId,firstAnchor
  UNWIND cited AS item
  WITH d,heads,item[0] AS citation,item[1] AS doc,firstSourceId,firstRevisionId,firstAnchor
  CREATE (d)-[:CITES {type:'CITES',relationship_id:citation[4],source_id_endpoint:$decisionId,target_id:doc.semantic_id,
    source_id:doc.source_id,document_revision_id:doc.semantic_id,anchor:citation[2],asserted_at:$reviewedAt,
    validity_state:'current',review_state:'reviewed'}]->(doc)
  WITH DISTINCT d,heads,firstSourceId,firstRevisionId,firstAnchor
  FOREACH (h IN heads | CREATE (d)-[:SUPERSEDES {type:'SUPERSEDES',relationship_id:$supersedesEdgeId,
    source_id_endpoint:$decisionId,target_id:h.semantic_id,source_id:firstSourceId,document_revision_id:firstRevisionId,
    anchor:$firstAnchor,asserted_at:$reviewedAt,validity_state:'current',review_state:'reviewed',
    acceptance_state:'accepted',reviewer_id:$reviewerId,reviewed_at:$reviewedAt}]->(h))
  RETURN d.semantic_id AS decisionId`;

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

interface ReviewInventoryRows {
  records: NodeRow[];
  edges: EdgeRow[];
}

interface ReceiptRow {
  decision: Record<string, unknown>;
  outgoing: Array<[string, Record<string, unknown>, Record<string, unknown>]>;
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

  async readSnapshot(subjectId: string, decisionKey: string): Promise<ReviewSnapshot> {
    try {
      const { records, edges } = await this.readInventory();
      const subject = records.find((record) => record.semantic_id === subjectId && record.type === 'Service');
      if (!subject) throw new GraphStoreError('unknown_target', 'Unknown service ID');
      const lineage = validateLineage({ subjectId, decisionKey, records, edges, inventoryComplete: true });
      const lineageRecords = records.filter((record) => record.type === 'Decision' && record.state === 'accepted'
        && record.scope_subject_id === subjectId && record.decision_key === decisionKey);
      const lineageInventory = lineageRecords.map((record) => decisionBinding(record)).sort((a, b) => a[0]!.localeCompare(b[0]!));
      const materialInventory = edges.map(materialBinding).sort((a, b) => a[0]!.localeCompare(b[0]!));
      const valid = new Map<string, ReviewedCitation>();
      for (const intent of ['impact', 'prerequisites', 'owners', 'current_rationale', 'history'] as const) {
        const report = projectEvidence({ requestId: randomUUID(), targetId: subjectId, intent, records, edges });
        for (const source of report.sources) {
          const citation = { revisionId: source.revisionId, anchor: source.anchor, contentDigest: source.contentDigest };
          valid.set(`${citation.revisionId}\u0000${citation.anchor}\u0000${citation.contentDigest}`, citation);
        }
      }
      return { subjectId, decisionKey, currentHeadId: lineage.status === 'complete' ? lineage.headId : null,
        lineageStatus: lineage.status, materialInventory, lineageInventory, validCitations: [...valid.values()] };
    } catch (error) {
      if (error instanceof GraphStoreError) throw error;
      throw new GraphStoreError('graph_unavailable', 'Review snapshot read failed', { cause: error });
    }
  }

  async lookupReceipt(requestId: string): Promise<ReceiptLookup> {
    try {
      const result = await this.graph.roQuery<ReceiptRow>(RECEIPT_QUERY, { params: { requestId }, TIMEOUT: this.timeoutMs });
      const rows = result.data ?? [];
      if (rows.length === 0) return { state: 'absent' };
      if (rows.length !== 1) return { state: 'integrity_failure' };
      const row = rows[0]!;
      const decision = row.decision;
      const canonicalJson = String(decision.intent_json ?? '');
      const digest = String(decision.intent_digest ?? '');
      const request = String(decision.request_id ?? '');
      const decisionId = String(decision.semantic_id ?? '');
      const subjectId = String(decision.scope_subject_id ?? '');
      const decisionKey = String(decision.decision_key ?? '');
      if (decision.state !== 'accepted' || decision.type !== 'Decision' || request !== requestId || !canonicalJson || !digest
        || createHash('sha256').update(canonicalJson).digest('hex') !== digest) return { state: 'integrity_failure' };
      let stable: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(canonicalJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'integrity_failure' };
        stable = parsed as Record<string, unknown>;
      } catch { return { state: 'integrity_failure' }; }
      if (stable.requestId !== requestId || stable.decisionId !== decisionId || stable.subjectId !== subjectId || stable.decisionKey !== decisionKey) {
        return { state: 'integrity_failure' };
      }
      const outgoing = row.outgoing ?? [];
      const about = outgoing.filter(([type]) => type === 'ABOUT');
      const cites = outgoing.filter(([type]) => type === 'CITES').sort((a, b) => String(a[1].relationship_id).localeCompare(String(b[1].relationship_id)));
      const supersedes = outgoing.filter(([type]) => type === 'SUPERSEDES');
      if (outgoing.some(([type]) => !['ABOUT', 'CITES', 'SUPERSEDES'].includes(type)) || about.length !== 1
        || about[0]![1].relationship_id !== `${decisionId}:about` || about[0]![2].semantic_id !== subjectId
        || !Array.isArray(stable.citations) || cites.length !== stable.citations.length
        || supersedes.length !== (stable.expectedPredecessorId ? 1 : 0)) return { state: 'integrity_failure' };
      const citationIds: string[] = [];
      for (const [index, [type, properties, document]] of cites.entries()) {
        const expected = (stable.citations as Array<Record<string, unknown>>)[index];
        if (type !== 'CITES' || properties.relationship_id !== `${decisionId}:cites:${index}`
          || properties.source_id_endpoint !== decisionId || properties.target_id !== expected?.revisionId
          || properties.anchor !== expected?.anchor || document.semantic_id !== expected?.revisionId
          || createHash('sha256').update(String(document.content ?? '')).digest('hex') !== expected?.contentDigest
          || document.content_digest !== expected?.contentDigest) return { state: 'integrity_failure' };
        citationIds.push(String(properties.relationship_id));
      }
      const supersedesEdgeId = supersedes[0]?.[1].relationship_id;
      if (supersedes.length && (supersedes[0]![2].semantic_id !== stable.expectedPredecessorId
        || supersedes[0]![1].acceptance_state !== 'accepted' || !supersedes[0]![1].reviewer_id || !supersedes[0]![1].reviewed_at)) {
        return { state: 'integrity_failure' };
      }
      const receipt: PersistedReceipt = { requestId, decisionId, digest, canonicalJson, subjectId, decisionKey,
        aboutEdgeId: String(about[0]![1].relationship_id), citesEdgeIds: citationIds,
        supersedesEdgeId: supersedesEdgeId ? String(supersedesEdgeId) : null };
      return { state: 'committed', receipt };
    } catch {
      return { state: 'unavailable' };
    }
  }

  async atomicCommit(intent: PersistableReviewIntent): Promise<AtomicCommitResult> {
    try {
      if (createHash('sha256').update(intent.canonicalJson).digest('hex') !== intent.digest) return { state: 'integrity_failure' };
      const stable: Record<string, unknown> = JSON.parse(intent.canonicalJson) as Record<string, unknown>;
      if (stable.requestId !== intent.requestId || stable.decisionId !== intent.decisionId || stable.subjectId !== intent.subjectId
        || stable.decisionKey !== intent.decisionKey || stable.expectedPredecessorId !== intent.expectedPredecessorId) return { state: 'integrity_failure' };
      const citations = intent.citations.map((citation, index) => [index, citation.revisionId, citation.anchor, citation.contentDigest, `${intent.decisionId}:cites:${index}`]);
      if (citations.length === 0) return { state: 'integrity_failure' };
      const first = intent.citations[0]!;
      const params = {
        subjectId: intent.subjectId, decisionKey: intent.decisionKey, materialInventory: intent.materialInventory.map((binding) => [...binding]),
        lineageInventory: intent.lineageInventory.map((binding) => [...binding]), predecessor: intent.expectedPredecessorId,
        requestId: intent.requestId, decisionId: intent.decisionId, text: intent.text, rationale: intent.rationale,
        reviewerId: intent.reviewerId, reviewedAt: new Date().toISOString(), intentVersion: intent.version,
        intentDigest: intent.digest, intentJson: intent.canonicalJson, citationBindings: citations,
        aboutEdgeId: `${intent.decisionId}:about`, supersedesEdgeId: intent.expectedPredecessorId ? `${intent.decisionId}:supersedes` : null,
        firstRevisionId: first.revisionId, firstAnchor: first.anchor,
      };
      const result = await this.graph.query<{ decisionId: string }>(ATOMIC_REVIEW_QUERY, { params, TIMEOUT: this.timeoutMs });
      if (result.data?.length === 1 && result.data[0]?.decisionId === intent.decisionId) return { state: 'created' };
      if ((result.data?.length ?? 0) > 1) return { state: 'integrity_failure' };
      const existing = await this.lookupReceipt(intent.requestId);
      if (existing.state === 'committed') return existing.receipt.digest === intent.digest ? { state: 'created' } : { state: 'conflict' };
      if (existing.state === 'integrity_failure') return { state: 'integrity_failure' };
      if (existing.state === 'unavailable') return { state: 'uncertain' };
      return { state: 'stale' };
    } catch {
      return { state: 'uncertain' };
    }
  }

  async classifyDecision(decisionId: string): Promise<'current' | 'historical' | 'unknown' | 'unavailable'> {
    try {
      const { records, edges } = await this.readInventory();
      const decision = records.find((record) => record.type === 'Decision' && record.semantic_id === decisionId && record.state === 'accepted');
      if (!decision || typeof decision.scope_subject_id !== 'string' || typeof decision.decision_key !== 'string') return 'unknown';
      const lineage = validateLineage({ subjectId: decision.scope_subject_id, decisionKey: decision.decision_key, records, edges, inventoryComplete: true });
      if (lineage.status !== 'complete' || !lineage.orderedIds.includes(decisionId) || !lineage.headId) return 'unknown';
      return lineage.headId === decisionId ? 'current' : 'historical';
    } catch { return 'unavailable'; }
  }

  private async readInventory(): Promise<{ records: SemanticRecord[]; edges: FactEdge[] }> {
    const [nodeResult, edgeResult] = await Promise.all([
      this.graph.roQuery<NodeRow>(RECORDS_QUERY, { TIMEOUT: this.timeoutMs }),
      this.graph.roQuery<EdgeRow>(EDGES_QUERY, { TIMEOUT: this.timeoutMs }),
    ]);
    return { records: (nodeResult.data ?? []).map(recordFromRow), edges: (edgeResult.data ?? []).map(edgeFromRow) };
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

function materialBinding(edge: FactEdge): string[] {
  const ownershipMode = (edge as FactEdge & { ownership_mode?: string }).ownership_mode ?? '';
  return [edge.relationship_id, edge.type, edge.source_id_endpoint, edge.target_id, edge.source_id, edge.document_revision_id,
    edge.anchor, edge.asserted_at, edge.validity_state, edge.review_state, edge.acceptance_state ?? '', edge.reviewer_id ?? '',
    edge.reviewed_at ?? '', ownershipMode];
}

function decisionBinding(record: SemanticRecord): string[] {
  return [record.semantic_id, String(record.scope_subject_id ?? ''), String(record.decision_key ?? ''), String(record.state ?? ''),
    String(record.name ?? ''), String(record.text ?? ''), String(record.rationale ?? ''), String(record.expected_predecessor_id ?? ''),
    String(record.intent_digest ?? ''), String(record.request_id ?? ''), String(record.reviewer_id ?? ''),
    String(record.reviewed_at ?? ''), String(record.intent_json ?? '')];
}

