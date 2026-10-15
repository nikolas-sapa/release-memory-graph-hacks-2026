import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses.js';
import type { EvidenceReport, FactRecord, IntentKey } from '../contracts.js';

export type ReadIntent = IntentKey;
export type ProposalType = 'review_owner' | 'revalidate_evidence' | 'confirm_dependency' | 'record_decision';

export interface DraftAction {
  type: ProposalType;
  entityId: string;
  factIds: string[];
}

export interface DraftSelection {
  factIds: string[];
  actions: DraftAction[];
}

export interface ValidatedDraft {
  facts: FactRecord[];
  actions: DraftAction[];
  renderedFacts: string[];
}

export interface ResponsesProvider {
  create(request: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Response>;
}

export class ReadAgentError extends Error {
  constructor(readonly code: 'unsupported_intent' | 'invalid_model_output' | 'drafting_unavailable', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReadAgentError';
  }
}

export interface ReadRequest {
  targetId: string;
  question: string;
}

export interface ReadWorkflow {
  selectIntent(): Promise<ReadIntent>;
  draft(report: EvidenceReport): Promise<ValidatedDraft>;
}
