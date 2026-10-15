import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type ScopeLineageStatus = 'complete' | 'absent' | 'incomplete' | 'conflict';

export interface ReviewedCitation {
  revisionId: string;
  anchor: string;
  contentDigest: string;
}

export interface ReviewDraft {
  subjectId: string;
  decisionKey: string;
  text: string;
  rationale: string;
  reviewerId: string;
  citations: ReviewedCitation[];
  expectedPredecessorId?: string | null;
}

export interface ReviewSnapshot {
  subjectId: string;
  decisionKey: string;
  currentHeadId: string | null;
  lineageStatus: ScopeLineageStatus;
  materialInventory: string[][];
  lineageInventory: string[][];
  validCitations: ReviewedCitation[];
}

export interface StableReviewIntent {
  version: 1;
  requestId: string;
  decisionId: string;
  subjectId: string;
  decisionKey: string;
  text: string;
  rationale: string;
  reviewerId: string;
  expectedPredecessorId: string | null;
  citations: readonly ReviewedCitation[];
  materialInventory: readonly (readonly string[])[];
  lineageInventory: readonly (readonly string[])[];
}

export interface ReviewIntent extends StableReviewIntent {
  canonicalJson: string;
  digest: string;
  confirmationNonce: string;
  createdAt: string;
}

export class ReviewError extends Error {
  constructor(readonly code: 'invalid_review' | 'stale_review' | 'review_expired' | 'intent_conflict' | 'integrity_failure' | 'graph_unavailable' | 'uncertain_write', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewError';
  }
}

export function createReviewIntent(draft: ReviewDraft, snapshot: ReviewSnapshot): ReviewIntent {
  validateDraft(draft, snapshot);
  const requestId = randomUUID();
  const decisionId = `decision:${randomUUID()}`;
  const expectedPredecessorId = draft.expectedPredecessorId ?? snapshot.currentHeadId;
  const stable: StableReviewIntent = Object.freeze({
    version: 1,
    requestId,
    decisionId,
    subjectId: draft.subjectId,
    decisionKey: draft.decisionKey,
    text: draft.text,
    rationale: draft.rationale,
    reviewerId: draft.reviewerId,
    expectedPredecessorId,
    citations: Object.freeze(draft.citations.map((citation) => Object.freeze({ ...citation }))) as unknown as ReviewedCitation[],
    materialInventory: Object.freeze(snapshot.materialInventory.map((binding) => Object.freeze([...binding])).sort((a, b) => a[0]!.localeCompare(b[0]!))),
    lineageInventory: Object.freeze(snapshot.lineageInventory.map((binding) => Object.freeze([...binding])).sort((a, b) => a[0]!.localeCompare(b[0]!))),
  });
  const canonicalJson = canonicalize(stable);
  const digest = createHash('sha256').update(canonicalJson).digest('hex');
  return Object.freeze({ ...stable, canonicalJson, digest, confirmationNonce: randomBytes(32).toString('base64url'), createdAt: new Date().toISOString() });
}

export function canonicalize(value: StableReviewIntent): string {
  return JSON.stringify({
    version: value.version,
    requestId: value.requestId,
    decisionId: value.decisionId,
    subjectId: value.subjectId,
    decisionKey: value.decisionKey,
    text: value.text,
    rationale: value.rationale,
    reviewerId: value.reviewerId,
    expectedPredecessorId: value.expectedPredecessorId,
    citations: value.citations.map(({ revisionId, anchor, contentDigest }) => ({ revisionId, anchor, contentDigest })),
    materialInventory: [...value.materialInventory].map((binding) => [...binding]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    lineageInventory: [...value.lineageInventory].map((binding) => [...binding]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
  });
}

function validateDraft(draft: ReviewDraft, snapshot: ReviewSnapshot): void {
  if (!id(draft.subjectId) || !id(draft.decisionKey) || !id(draft.reviewerId) || !text(draft.text) || !text(draft.rationale)
    || draft.subjectId !== snapshot.subjectId || draft.decisionKey !== snapshot.decisionKey
    || !['complete', 'absent'].includes(snapshot.lineageStatus)
    || (draft.expectedPredecessorId !== undefined && (draft.expectedPredecessorId ?? null) !== snapshot.currentHeadId)) {
    throw new ReviewError('invalid_review', 'Review scope, text, or complete lineage binding is invalid');
  }
  if (!Array.isArray(draft.citations) || draft.citations.length === 0 || !Array.isArray(snapshot.materialInventory)
    || !Array.isArray(snapshot.lineageInventory) || snapshot.materialInventory.some((binding) => !Array.isArray(binding) || binding.length === 0)
    || new Set(snapshot.materialInventory.map((binding) => binding[0])).size !== snapshot.materialInventory.length
    || new Set(snapshot.lineageInventory.map((binding) => binding[0])).size !== snapshot.lineageInventory.length) {
    throw new ReviewError('invalid_review', 'Review requires exact citations and unique material bindings');
  }
  const allowed = new Set(snapshot.validCitations.map(citationKey));
  const seen = new Set<string>();
  for (const citation of draft.citations) {
    const key = citationKey(citation);
    if (!allowed.has(key) || seen.has(key)) throw new ReviewError('invalid_review', 'Citation is absent, duplicated, or does not match immutable source evidence');
    seen.add(key);
  }
}

function citationKey(citation: ReviewedCitation): string {
  return `${citation.revisionId}\u0000${citation.anchor}\u0000${citation.contentDigest}`;
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= 8192;
}
