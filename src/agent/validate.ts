import type { EvidenceReport, FactRecord } from '../contracts.js';
import { ReadAgentError, type DraftAction, type DraftSelection, type ProposalType, type ValidatedDraft } from './types.js';

const proposals = new Set<ProposalType>(['review_owner', 'revalidate_evidence', 'confirm_dependency', 'record_decision']);

export function parseDraftOutput(text: string): DraftSelection {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ReadAgentError('invalid_model_output', 'Draft output was not valid JSON'); }
  if (!plainObject(value) || !exactKeys(value, ['factIds', 'actions']) || !Array.isArray(value.factIds) || !Array.isArray(value.actions)
    || !value.factIds.every((id) => typeof id === 'string') || !value.actions.every(validActionShape)) {
    throw new ReadAgentError('invalid_model_output', 'Draft output did not match the supported contract');
  }
  return value as unknown as DraftSelection;
}

export function validateDraft(report: EvidenceReport, selection: DraftSelection): ValidatedDraft {
  if (report.status === 'unavailable') throw new ReadAgentError('drafting_unavailable', 'Graph evidence is unavailable');
  const factsById = new Map(report.facts.map((fact) => [fact.id, fact]));
  const factIds = new Set<string>();
  const facts: FactRecord[] = [];
  for (const id of selection.factIds) {
    const fact = factsById.get(id);
    if (!fact || factIds.has(id)) throw new ReadAgentError('invalid_model_output', 'Draft selected an unknown or duplicate fact');
    factIds.add(id);
    facts.push(fact);
  }
  const entities = new Set([...report.entities.services, ...report.entities.projects, ...report.entities.owners,
    ...report.decisions.flatMap((group) => [group.subjectId, ...group.decisions.map((decision) => decision.id)])]);
  const actionKeys = new Set<string>();
  const actions: DraftAction[] = [];
  for (const action of selection.actions) {
    if (!proposals.has(action.type) || !entities.has(action.entityId) || action.factIds.length === 0) {
      throw new ReadAgentError('invalid_model_output', 'Draft proposed an unsupported action or entity');
    }
    const key = `${action.type}\u0000${action.entityId}`;
    if (actionKeys.has(key)) throw new ReadAgentError('invalid_model_output', 'Draft repeated an action');
    actionKeys.add(key);
    if (new Set(action.factIds).size !== action.factIds.length) throw new ReadAgentError('invalid_model_output', 'Action repeated a fact reference');
    const actionFacts = action.factIds.map((id) => factsById.get(id));
    if (actionFacts.some((fact) => !fact || !factIds.has(fact.id))) {
      throw new ReadAgentError('invalid_model_output', 'Action cited a fact outside the selected evidence');
    }
    const requiredPredicate = action.type === 'review_owner' ? 'OWNS' : action.type === 'confirm_dependency' ? 'DEPENDS_ON' : null;
    if (requiredPredicate && actionFacts.some((fact) => fact?.predicate !== requiredPredicate)) {
      throw new ReadAgentError('invalid_model_output', 'Action type does not match its cited fact predicate');
    }
    if (!actionFacts.some((fact) => fact!.subjectId === action.entityId || fact!.objectId === action.entityId)) {
      throw new ReadAgentError('invalid_model_output', 'Action entity is not bound to its cited facts');
    }
    actions.push({ type: action.type, entityId: action.entityId, factIds: [...action.factIds] });
  }
  return { facts, actions, renderedFacts: facts.map(renderFact) };
}

function renderFact(fact: FactRecord): string {
  const sources = fact.sources.map((source) => `${source.revisionId}#${source.anchor}`).join(', ');
  return `${fact.subjectId} ${fact.predicate} ${fact.objectId}${sources ? ` [${sources}]` : ''}.`;
}

function validActionShape(value: unknown): value is DraftAction {
  return plainObject(value) && exactKeys(value, ['type', 'entityId', 'factIds']) && typeof value.type === 'string'
    && typeof value.entityId === 'string' && Array.isArray(value.factIds) && value.factIds.length > 0
    && value.factIds.every((id) => typeof id === 'string');
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
