import type { LineageInput, LineageResult } from '../contracts.js';

/** Validate the complete accepted inventory, never a timestamp-selected suffix. */
export function validateLineage(input: LineageInput): LineageResult {
  const result = (status: LineageResult['status']): LineageResult => ({ status, headId: null, orderedIds: [] });
  if (input.inventoryComplete === false) return result('incomplete');
  const accepted = input.records.filter((record) => record.type === 'Decision' && record.state === 'accepted');
  const scoped = accepted.filter((record) => record.scope_subject_id === input.subjectId && record.decision_key === input.decisionKey);
  const about = input.edges.filter((edge) => edge.type === 'ABOUT');
  // ABOUT cannot smuggle a differently declared decision into this scope.
  if (accepted.some((record) => record.decision_key === input.decisionKey
      && about.some((edge) => edge.source_id_endpoint === record.semantic_id && edge.target_id === input.subjectId)
      && record.scope_subject_id !== input.subjectId)) return result('conflict');
  if (scoped.length === 0) return result('absent');
  const ids = new Set(scoped.map((record) => record.semantic_id));
  if (ids.size !== scoped.length) return result('conflict');
  for (const record of scoped) {
    const links = about.filter((edge) => edge.source_id_endpoint === record.semantic_id);
    if (links.length !== 1 || links[0]?.target_id !== input.subjectId) return result('conflict');
    if (links[0]?.validity_state !== 'current' || links[0]?.review_state !== 'reviewed') return result('incomplete');
  }
  const links = input.edges.filter((edge) => edge.type === 'SUPERSEDES'
    && (ids.has(edge.source_id_endpoint) || ids.has(edge.target_id)));
  if (links.some((edge) => !ids.has(edge.source_id_endpoint) || !ids.has(edge.target_id)
      || edge.acceptance_state !== 'accepted' || !edge.reviewer_id || !edge.reviewed_at)) return result('conflict');
  if (links.some((edge) => edge.validity_state !== 'current' || edge.review_state !== 'reviewed')) return result('incomplete');
  if (links.length !== scoped.length - 1) return result('conflict');
  const predecessor = new Map<string, string>();
  const successor = new Map<string, string>();
  for (const edge of links) {
    if (predecessor.has(edge.source_id_endpoint) || successor.has(edge.target_id)) return result('conflict');
    predecessor.set(edge.source_id_endpoint, edge.target_id);
    successor.set(edge.target_id, edge.source_id_endpoint);
  }
  for (const record of scoped) {
    const expected = record.expected_predecessor_id;
    if (expected !== undefined && expected !== null && expected !== predecessor.get(record.semantic_id)) return result('conflict');
  }
  const heads = [...ids].filter((id) => !successor.has(id));
  if (heads.length !== 1) return result('conflict');
  const orderedIds: string[] = [];
  let cursor: string | undefined = heads[0];
  while (cursor !== undefined) {
    if (orderedIds.includes(cursor)) return result('conflict');
    orderedIds.push(cursor);
    cursor = predecessor.get(cursor);
  }
  if (orderedIds.length !== ids.size) return result('conflict');
  return { status: 'complete', headId: heads[0] ?? null, orderedIds };
}
