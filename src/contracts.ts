import type { FactEdge, NodeType, RelationType, SemanticRecord } from '../fixtures/generate.js';

export type IntentKey = 'impact' | 'prerequisites' | 'owners' | 'current_rationale' | 'history';
export type RetrievalStatus = 'complete' | 'incomplete' | 'conflict' | 'unavailable';
export type LineageStatus = 'absent' | 'complete' | 'conflict' | 'incomplete';

export interface EvidenceSource {
  revisionId: string;
  sourceId: string;
  revisionIdentity: string;
  anchor: string;
  contentDigest: string;
  excerpt: string;
}

export interface FactRecord {
  id: string;
  predicate: RelationType;
  subjectId: string;
  objectId: string;
  edgeIds: string[];
  sources: EvidenceSource[];
}

export interface EvidencePath {
  nodeIds: string[];
  edgeIds: string[];
}

export interface DecisionEvidence {
  id: string;
  state: 'current' | 'historical';
  rationale: string;
  citationRevisionIds: string[];
}

export interface DecisionGroup {
  subjectId: string;
  decisionKey: string;
  status: LineageStatus;
  headId: string | null;
  decisions: DecisionEvidence[];
}

export interface EvidenceGap {
  code: string;
  entityId?: string;
  edgeId?: string;
}

export interface EvidenceCompleteness {
  traversal: boolean;
  paths: boolean;
  lineage: boolean;
  sourceCoverage: boolean;
}

export interface EvidenceLimits {
  depth: number;
  pathCap: number;
  overflow: boolean;
  frontierIds: string[];
}

export interface EvidenceReport {
  requestId: string;
  targetId: string;
  intent: IntentKey;
  status: RetrievalStatus;
  entities: {
    services: string[];
    projects: string[];
    owners: string[];
  };
  edges: FactEdge[];
  paths: EvidencePath[];
  facts: FactRecord[];
  sources: EvidenceSource[];
  decisions: DecisionGroup[];
  gaps: EvidenceGap[];
  completeness: EvidenceCompleteness;
  limits: EvidenceLimits;
}

export interface SourceLookupRequest {
  requestId: string;
  revisionId: string;
  anchor: string;
}

export interface LineageInput {
  subjectId: string;
  decisionKey: string;
  records: SemanticRecord[];
  edges: FactEdge[];
  inventoryComplete?: boolean;
}

export interface LineageResult {
  status: LineageStatus;
  headId: string | null;
  orderedIds: string[];
}

export interface EvidenceAssemblyInput {
  requestId: string;
  targetId: string;
  intent: IntentKey;
  records: SemanticRecord[];
  edges: FactEdge[];
  coverage?: EvidenceCompleteness;
  paths?: EvidencePath[];
  decisions?: DecisionGroup[];
  gaps?: EvidenceGap[];
  limits?: Partial<EvidenceLimits>;
}

export interface GraphStoreConfig {
  url: string;
  graphName?: string;
  timeoutMs?: number;
}

export type { FactEdge, NodeType, RelationType, SemanticRecord };
