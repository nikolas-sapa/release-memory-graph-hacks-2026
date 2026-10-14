import { createHash } from 'node:crypto';
import type { EvidenceAssemblyInput, EvidenceGap, EvidenceReport, EvidenceSource, FactEdge, SemanticRecord } from '../contracts.js';

const unique = (values: string[]): string[] => [...new Set(values)].sort();

export function assembleEvidence(input: EvidenceAssemblyInput): EvidenceReport {
  const gaps: EvidenceGap[] = [...(input.gaps ?? [])];
  const byId = new Map<string, SemanticRecord>();
  const duplicateIds = new Set<string>();
  for (const record of input.records) {
    if (byId.has(record.semantic_id)) duplicateIds.add(record.semantic_id);
    byId.set(record.semantic_id, record);
  }
  for (const id of duplicateIds) gaps.push({ code: 'identity_conflict', entityId: id });
  const revisionKeys = new Map<string, string>();
  for (const record of input.records.filter((item) => item.type === 'Document')) {
    const key = `${String(record.source_id)}\u0000${String(record.revision_identity)}`;
    if (revisionKeys.has(key)) {
      duplicateIds.add(record.semantic_id);
      duplicateIds.add(revisionKeys.get(key)!);
      gaps.push({ code: 'source_revision_conflict', entityId: record.semantic_id });
    } else revisionKeys.set(key, record.semantic_id);
  }
  const sources = new Map<string, EvidenceSource>();
  const rationaleSources = new Map<string, EvidenceSource>();
  const facts: EvidenceReport['facts'] = [];
  const sourceCoverage = { valid: !gaps.some((gap) => ['missing_current_revision', 'missing_rationale_citation', 'unsupported_rationale'].includes(gap.code)) };
  const prove = (edge: FactEdge): EvidenceSource | null => {
    const fail = (code: string): null => { sourceCoverage.valid = false; gaps.push({ code, edgeId: edge.relationship_id }); return null; };
    if (!edge.relationship_id || !edge.document_revision_id || !edge.anchor || !edge.source_id) return fail('missing_revision_identity');
    if (duplicateIds.has(edge.document_revision_id)) return fail('identity_conflict');
    const document = byId.get(edge.document_revision_id);
    if (!document || document.type !== 'Document') return fail('missing_revision');
    if (!document.revision_identity || document.source_id !== edge.source_id || typeof document.content !== 'string'
      || typeof document.content_digest !== 'string') return fail('invalid_revision_identity');
    if (!['current', 'historical'].includes(String(document.applicability_state))) return fail('stale_source_applicability');
    if (createHash('sha256').update(document.content).digest('hex') !== document.content_digest) return fail('content_digest_mismatch');
    const assertion = `At ${edge.anchor}, fictional review asserts ${edge.source_id_endpoint} ${edge.type} ${edge.target_id} with ${edge.validity_state} validity and ${edge.review_state} review state.`;
    const lines = document.content.split('\n');
    const excerpt = lines.find((line) => line === assertion);
    if (!excerpt) return fail(document.content.includes(edge.anchor) ? 'unsupported_claim' : 'missing_anchor');
    const source: EvidenceSource = { revisionId: document.semantic_id, sourceId: edge.source_id,
      revisionIdentity: String(document.revision_identity), anchor: edge.anchor, contentDigest: document.content_digest, excerpt };
    if (edge.type === 'CITES') {
      const decision = byId.get(edge.source_id_endpoint);
      const cited = byId.get(edge.target_id);
      if (!cited || duplicateIds.has(cited.semantic_id) || !cited.source_id || !cited.revision_identity
          || typeof cited.content !== 'string' || typeof cited.content_digest !== 'string'
          || !['current', 'historical'].includes(String(cited.applicability_state))
          || createHash('sha256').update(cited.content).digest('hex') !== cited.content_digest) return fail('invalid_cited_revision');
      const rationaleExcerpt = `Synthetic rationale anchor ${edge.anchor}: ${String(decision?.rationale ?? '')}`;
      if (!cited.content.split('\n').includes(rationaleExcerpt)) return fail('unsupported_rationale');
      const rationaleSource: EvidenceSource = { revisionId: cited.semantic_id, sourceId: String(cited.source_id),
        revisionIdentity: String(cited.revision_identity), anchor: edge.anchor, contentDigest: cited.content_digest, excerpt: rationaleExcerpt };
      rationaleSources.set(edge.relationship_id, rationaleSource);
      sources.set(`${rationaleSource.revisionId}\u0000${rationaleSource.anchor}\u0000rationale`, rationaleSource);
    }
    sources.set(`${source.revisionId}\u0000${source.anchor}`, source);
    return source;
  };
  const seenEdges = new Set<string>();
  for (const edge of input.edges) {
    if (seenEdges.has(edge.relationship_id)) { gaps.push({ code: 'identity_conflict', edgeId: edge.relationship_id }); sourceCoverage.valid = false; continue; }
    seenEdges.add(edge.relationship_id);
    const from = byId.get(edge.source_id_endpoint);
    const to = byId.get(edge.target_id);
    if (!from || !to) { gaps.push({ code: 'dangling_endpoint', edgeId: edge.relationship_id }); sourceCoverage.valid = false; continue; }
    if (duplicateIds.has(from.semantic_id) || duplicateIds.has(to.semantic_id)) { gaps.push({ code: 'identity_conflict', edgeId: edge.relationship_id }); sourceCoverage.valid = false; continue; }
    const endpointTypes = {
      OWNS: from.type === 'Person' && ['Service', 'Project'].includes(to.type),
      USES: from.type === 'Project' && to.type === 'Service',
      DEPENDS_ON: from.type === 'Service' && to.type === 'Service',
      AFFECTS: from.type === 'Ticket' && ['Service', 'Project'].includes(to.type),
      ABOUT: from.type === 'Decision' && ['Service', 'Project', 'Ticket'].includes(to.type),
      CITES: from.type === 'Decision' && to.type === 'Document',
      SUPERSEDES: from.type === 'Decision' && to.type === 'Decision',
      REVISES: from.type === 'Document' && to.type === 'Document',
    };
    if (!endpointTypes[edge.type]) { gaps.push({ code: 'invalid_typed_endpoint', edgeId: edge.relationship_id }); sourceCoverage.valid = false; continue; }
    const source = prove(edge);
    if (edge.validity_state !== 'current' || edge.review_state !== 'reviewed') {
      gaps.push({ code: edge.review_state === 'disputed' ? 'disputed_fact_conflict' : 'stale_or_unreviewed_fact', edgeId: edge.relationship_id });
      sourceCoverage.valid = false;
      continue;
    }
    if (!source) continue;
    const rationaleSource = rationaleSources.get(edge.relationship_id);
    facts.push({ id: `fact:${edge.relationship_id}`, predicate: edge.type, subjectId: edge.source_id_endpoint,
      objectId: edge.target_id, edgeIds: [edge.relationship_id], sources: rationaleSource ? [source, rationaleSource] : [source] });
  }
  // Distinct explicitly-current revisions of one source cannot silently resolve.
  const currentSources = new Map<string, string[]>();
  for (const record of input.records.filter((item) => item.type === 'Document' && item.applicability_state === 'current')) {
    const sourceId = String(record.source_id);
    currentSources.set(sourceId, [...(currentSources.get(sourceId) ?? []), record.semantic_id]);
  }
  for (const [sourceId, ids] of currentSources) if (ids.length > 1) {
    gaps.push({ code: 'source_revision_conflict', entityId: sourceId });
    sourceCoverage.valid = false;
  }
  let supportedOwners = input.edges.filter((edge) => edge.type === 'OWNS' && facts.some((fact) => fact.edgeIds.includes(edge.relationship_id)));
  const conflictingOwnedTargets = new Set<string>();
  for (const target of unique(supportedOwners.map((edge) => edge.target_id))) {
    const ownerEdges = supportedOwners.filter((edge) => edge.target_id === target);
    if (ownerEdges.length > 1 && ownerEdges.some((edge) => (edge as FactEdge & { exclusive?: boolean; ownership_mode?: string }).exclusive === true
        || (edge as FactEdge & { ownership_mode?: string }).ownership_mode === 'exclusive')) {
      gaps.push({ code: 'ownership_conflict', entityId: target });
      conflictingOwnedTargets.add(target);
    }
  }
  // Keep conflicting edge/source evidence visible, but never publish it as an authoritative current owner fact.
  for (let index = facts.length - 1; index >= 0; index--) if (facts[index]?.predicate === 'OWNS'
    && conflictingOwnedTargets.has(facts[index]!.objectId)) facts.splice(index, 1);
  supportedOwners = supportedOwners.filter((edge) => !conflictingOwnedTargets.has(edge.target_id));
  // One route identity (revision, anchor) always resolves one contiguous immutable excerpt,
  // including both the relation and rationale when they share an anchor.
  const canonicalSources = new Map<string, EvidenceSource>();
  for (const source of sources.values()) {
    const lines = String(byId.get(source.revisionId)?.content ?? '').split('\n');
    const matching = lines.flatMap((line, index) => line.startsWith(`At ${source.anchor},`)
      || line.startsWith(`Synthetic rationale anchor ${source.anchor}:`) ? [index] : []);
    const start = matching[0];
    const end = matching.at(-1);
    const canonical = { ...source, excerpt: start === undefined || end === undefined ? source.excerpt : lines.slice(start, end + 1).join('\n') };
    canonicalSources.set(`${source.revisionId}\u0000${source.anchor}`, canonical);
  }
  for (const fact of facts) fact.sources = fact.sources.map((source) => canonicalSources.get(`${source.revisionId}\u0000${source.anchor}`) ?? source);
  const decisions = input.decisions ?? [];
  for (const group of decisions) if (group.status === 'conflict' || group.status === 'incomplete') gaps.push({ code: `lineage_${group.status}`, entityId: group.subjectId });
  const pathCap = input.limits?.pathCap ?? 100;
  const pathOverflow = (input.paths?.length ?? 0) > pathCap || input.limits?.overflow === true;
  if (pathOverflow) gaps.push({ code: 'path_overflow' });
  if (!byId.has(input.targetId)) gaps.push({ code: 'unknown_target', entityId: input.targetId });
  const completeness = { traversal: input.coverage?.traversal ?? true, paths: (input.coverage?.paths ?? true) && !pathOverflow,
    lineage: (input.coverage?.lineage ?? true) && decisions.every((group) => group.status === 'complete' || group.status === 'absent'),
    sourceCoverage: (input.coverage?.sourceCoverage ?? true) && sourceCoverage.valid };
  const conflict = gaps.some((gap) => gap.code.includes('conflict'));
  const incomplete = gaps.some((gap) => !['dependency_cycle', 'no_accepted_decisions'].includes(gap.code)) || Object.values(completeness).some((complete) => !complete);
  const services = unique(input.records.filter((record) => record.type === 'Service').map((record) => record.semantic_id));
  const projects = unique(input.records.filter((record) => record.type === 'Project').map((record) => record.semantic_id));
  return { requestId: input.requestId, targetId: input.targetId, intent: input.intent,
    status: conflict ? 'conflict' : incomplete ? 'incomplete' : 'complete',
    entities: { services, projects, owners: unique(supportedOwners.map((edge) => edge.source_id_endpoint)) },
    edges: input.edges, paths: (input.paths ?? []).slice(0, pathCap), facts, sources: [...canonicalSources.values()], decisions, gaps, completeness,
    limits: { depth: input.limits?.depth ?? 6, pathCap: input.limits?.pathCap ?? 100,
      overflow: pathOverflow, frontierIds: input.limits?.frontierIds ?? [] } };
}
