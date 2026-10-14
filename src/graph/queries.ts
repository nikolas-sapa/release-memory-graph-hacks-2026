import type { EvidenceGap, EvidencePath, EvidenceReport, FactEdge, IntentKey, SemanticRecord } from '../contracts.js';
import { assembleEvidence } from '../evidence/assemble.js';
import { validateLineage } from './lineage.js';

export const RECORDS_QUERY = 'MATCH (n) RETURN labels(n) AS labels, properties(n) AS properties';
export const EDGES_QUERY = 'MATCH (a)-[e]->(b) RETURN properties(a) AS sourceProperties, type(e) AS type, properties(e) AS properties, properties(b) AS targetProperties';
export const SOURCE_QUERY = 'MATCH (d:Document {semantic_id:$revisionId}) RETURN properties(d) AS document';

export interface ProjectionInput {
  requestId: string;
  targetId: string;
  intent: IntentKey;
  records: SemanticRecord[];
  edges: FactEdge[];
  depth?: number;
  pathCap?: number;
}

export function projectEvidence(input: ProjectionInput): EvidenceReport {
  const depth = bounded(input.depth, 6, 0, 6);
  const pathCap = bounded(input.pathCap, 100, 1, 100);
  const byId = new Map(input.records.map((record) => [record.semantic_id, record]));
  const target = byId.get(input.targetId);
  if (!target || target.type !== 'Service') throw new Error('unknown_target');
  const included = new Set([input.targetId]);
  const edgeIds = new Set<string>();
  const paths: EvidencePath[] = [];
  const gaps: EvidenceGap[] = [];
  const frontier = new Set<string>();
  const proofOnlyIds = new Set<string>();
  const frontierEdges = new Map<string, string>();
  let overflow = false;
  const decisions: EvidenceReport['decisions'] = [];
  const addPath = (path: EvidencePath): void => {
    if (paths.length < pathCap) paths.push(path);
    else overflow = true;
  };
  const includeEdge = (edge: FactEdge): void => {
    edgeIds.add(edge.relationship_id);
    included.add(edge.source_id_endpoint);
    included.add(edge.target_id);
  };
  const dependencies = input.edges.filter((edge) => edge.type === 'DEPENDS_ON');
  if (input.intent === 'impact' || input.intent === 'prerequisites') {
    const incoming = input.intent === 'impact';
    const adjacent = (id: string): FactEdge[] => dependencies.filter((edge) => (incoming ? edge.target_id : edge.source_id_endpoint) === id);
    const visit = (nodeId: string, path: EvidencePath): void => {
      const edges = adjacent(nodeId);
      if (path.edgeIds.length === depth) {
        for (const edge of edges) {
          const next = incoming ? edge.source_id_endpoint : edge.target_id;
          if (path.nodeIds.includes(next)) {
            includeEdge(edge);
            gaps.push({ code: 'dependency_cycle', edgeId: edge.relationship_id });
          } else {
            frontier.add(next);
            edgeIds.add(edge.relationship_id);
            proofOnlyIds.add(next);
            frontierEdges.set(edge.relationship_id, next);
          }
        }
        return;
      }
      for (const edge of edges) {
        const next = incoming ? edge.source_id_endpoint : edge.target_id;
        includeEdge(edge);
        if (byId.get(next)?.type !== 'Service') { gaps.push({ code: 'invalid_dependency_endpoint', edgeId: edge.relationship_id }); continue; }
        if (path.nodeIds.includes(next)) { gaps.push({ code: 'dependency_cycle', edgeId: edge.relationship_id }); continue; }
        const nextPath = { nodeIds: [...path.nodeIds, next], edgeIds: [...path.edgeIds, edge.relationship_id] };
        addPath(nextPath);
        // Once overflow is established, breadth inventory below still establishes reachable entities.
        if (!overflow) visit(next, nextPath);
      }
    };
    addPath({ nodeIds: [input.targetId], edgeIds: [] });
    visit(input.targetId, { nodeIds: [input.targetId], edgeIds: [] });
    // Shortest-distance inventory is independent of displayed-path budget.
    const distance = new Map([[input.targetId, 0]]);
    const queue = [input.targetId];
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]!;
      const hops = distance.get(node)!;
      for (const edge of adjacent(node)) {
        const next = incoming ? edge.source_id_endpoint : edge.target_id;
        if (hops === depth) {
          if (!distance.has(next)) {
            frontier.add(next);
            edgeIds.add(edge.relationship_id);
            proofOnlyIds.add(next);
            frontierEdges.set(edge.relationship_id, next);
          }
          else includeEdge(edge);
          continue;
        }
        includeEdge(edge);
        if (!distance.has(next) && byId.get(next)?.type === 'Service') { distance.set(next, hops + 1); queue.push(next); }
      }
    }
    // A node reached by another shorter path is expanded, hence not an unexpanded frontier.
    for (const id of frontier) if ((distance.get(id) ?? depth + 1) <= depth) frontier.delete(id);
    // Cycles remain visible even if displayed path enumeration stopped at its cap.
    const active = new Set<string>();
    const finished = new Set<string>();
    const detectCycles = (node: string): void => {
      if (finished.has(node)) return;
      active.add(node);
      for (const edge of adjacent(node).filter((item) => edgeIds.has(item.relationship_id))) {
        const next = incoming ? edge.source_id_endpoint : edge.target_id;
        if (active.has(next)) {
          if (!gaps.some((gap) => gap.code === 'dependency_cycle' && gap.edgeId === edge.relationship_id)) gaps.push({ code: 'dependency_cycle', edgeId: edge.relationship_id });
        } else detectCycles(next);
      }
      active.delete(node);
      finished.add(node);
    };
    detectCycles(input.targetId);
    if (incoming) {
      for (const edge of input.edges.filter((item) => item.type === 'USES' && included.has(item.target_id))) {
        if (byId.get(edge.source_id_endpoint)?.type !== 'Project') { gaps.push({ code: 'invalid_usage_endpoint', edgeId: edge.relationship_id }); continue; }
        includeEdge(edge);
        addPath({ nodeIds: [edge.source_id_endpoint, edge.target_id], edgeIds: [edge.relationship_id] });
      }
    }
  }
  if (['impact', 'prerequisites', 'owners'].includes(input.intent)) {
    const ownedTargets = [...included].filter((id) => ['Service', 'Project'].includes(byId.get(id)?.type ?? ''));
    for (const subject of ownedTargets) {
      const owners = input.edges.filter((edge) => edge.type === 'OWNS' && edge.target_id === subject);
      if (!owners.some((edge) => edge.validity_state === 'current' && edge.review_state === 'reviewed')) gaps.push({ code: 'missing_owner', entityId: subject });
      for (const edge of owners) {
        if (byId.get(edge.source_id_endpoint)?.type !== 'Person') { gaps.push({ code: 'invalid_owner_endpoint', edgeId: edge.relationship_id }); continue; }
        includeEdge(edge);
        addPath({ nodeIds: [edge.source_id_endpoint, edge.target_id], edgeIds: [edge.relationship_id] });
      }
    }
  } else {
    const scopes = new Set(input.records.filter((record) => record.type === 'Decision' && record.state === 'accepted'
      && (record.scope_subject_id === input.targetId || input.edges.some((edge) => edge.type === 'ABOUT'
        && edge.source_id_endpoint === record.semantic_id && edge.target_id === input.targetId))).map((record) => String(record.decision_key)));
    if (scopes.size === 0) gaps.push({ code: 'no_accepted_decisions', entityId: input.targetId });
    for (const decisionKey of [...scopes].sort()) {
      const lineage = validateLineage({ subjectId: input.targetId, decisionKey, records: input.records, edges: input.edges });
      const scopeRecords = input.records.filter((record) => record.type === 'Decision' && record.scope_subject_id === input.targetId && record.decision_key === decisionKey && record.state === 'accepted');
      const scopeIds = new Set(scopeRecords.map((record) => record.semantic_id));
      for (const record of scopeRecords) included.add(record.semantic_id);
      for (const edge of input.edges.filter((item) => ['ABOUT', 'CITES', 'SUPERSEDES'].includes(item.type)
        && (scopeIds.has(item.source_id_endpoint) || (item.type === 'SUPERSEDES' && scopeIds.has(item.target_id))))) {
        includeEdge(edge);
        addPath({ nodeIds: [edge.source_id_endpoint, edge.target_id], edgeIds: [edge.relationship_id] });
      }
      const ordered = lineage.status === 'complete' ? lineage.orderedIds : [];
      decisions.push({ subjectId: input.targetId, decisionKey, status: lineage.status, headId: lineage.headId,
        decisions: ordered.map((id) => {
          const record = byId.get(id)!;
          const citations = input.edges.filter((edge) => edge.type === 'CITES' && edge.source_id_endpoint === id);
          if (citations.length === 0) gaps.push({ code: 'missing_rationale_citation', entityId: id });
          for (const edge of citations) {
            const doc = byId.get(edge.target_id);
            if (doc?.type !== 'Document' || typeof doc.content !== 'string'
              || !doc.content.split('\n').includes(`Synthetic rationale anchor ${edge.anchor}: ${String(record.rationale)}`)) gaps.push({ code: 'unsupported_rationale', entityId: id, edgeId: edge.relationship_id });
          }
          return { id, state: id === lineage.headId ? 'current' : 'historical', rationale: String(record.rationale ?? ''), citationRevisionIds: [...new Set(citations.map((edge) => edge.target_id))].sort() };
        }) });
    }
  }
  for (const [edgeId, entityId] of frontierEdges) if (frontier.has(entityId)) gaps.push({ code: 'unexpanded_frontier', edgeId, entityId });
  if (overflow) gaps.push({ code: 'path_overflow' });
  const selectedEdges = input.edges.filter((edge) => edgeIds.has(edge.relationship_id));
  const relevantSources = new Set<string>();
  for (const edge of selectedEdges) {
    included.add(edge.document_revision_id);
    relevantSources.add(edge.source_id);
    if (edge.type === 'CITES') relevantSources.add(String(byId.get(edge.target_id)?.source_id));
  }
  // Full immutable revision inventory for each cited source detects identity/current conflicts.
  for (const record of input.records) if (record.type === 'Document' && relevantSources.has(String(record.source_id))) included.add(record.semantic_id);
  for (const sourceId of relevantSources) if (!input.records.some((record) => record.type === 'Document'
      && record.source_id === sourceId && record.applicability_state === 'current')) gaps.push({ code: 'missing_current_revision', entityId: sourceId });
  const report = assembleEvidence({ requestId: input.requestId, targetId: input.targetId, intent: input.intent,
    records: input.records.filter((record) => included.has(record.semantic_id) || proofOnlyIds.has(record.semantic_id)), edges: selectedEdges, paths, decisions, gaps,
    coverage: { traversal: frontier.size === 0, paths: !overflow, lineage: true, sourceCoverage: true },
    limits: { depth, pathCap, overflow, frontierIds: [...frontier].sort() } });
  report.entities.services = report.entities.services.filter((id) => included.has(id));
  return report;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('invalid_bounds');
  return value;
}
