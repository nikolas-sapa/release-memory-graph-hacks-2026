import { createHash } from 'node:crypto';
import { ReviewError, createReviewIntent, type ReviewDraft, type ReviewIntent, type ReviewSnapshot } from './review.js';

export interface PersistedReceipt {
  requestId: string;
  decisionId: string;
  digest: string;
  canonicalJson: string;
  subjectId: string;
  decisionKey: string;
  aboutEdgeId: string;
  citesEdgeIds: string[];
  supersedesEdgeId: string | null;
}

export type ReceiptLookup = { state: 'absent' } | { state: 'committed'; receipt: PersistedReceipt } | { state: 'conflict' }
  | { state: 'integrity_failure' } | { state: 'unavailable' };

export type AtomicCommitResult = { state: 'created' } | { state: 'stale' } | { state: 'conflict' }
  | { state: 'integrity_failure' } | { state: 'uncertain' };

export interface ReviewStorePort {
  lookupReceipt(requestId: string): Promise<ReceiptLookup>;
  readSnapshot(subjectId: string, decisionKey: string): Promise<ReviewSnapshot>;
  atomicCommit(intent: PersistableReviewIntent): Promise<AtomicCommitResult>;
  classifyDecision(decisionId: string): Promise<'current' | 'historical' | 'unknown' | 'unavailable'>;
}

export type PersistableReviewIntent = Omit<ReviewIntent, 'confirmationNonce' | 'createdAt'>;

export interface ConfirmRequest {
  requestId: string;
  expectedDigest: string;
  confirmationNonce: string;
  participantConfirmed: boolean;
}

export type ConfirmResult = { state: 'committed'; decisionId: string; classification: 'current' | 'historical' };

export type ReviewStatus = { state: 'committed'; decisionId: string; classification: 'current' | 'historical' }
  | { state: 'pending'; digest: string } | { state: 'absent' } | { state: 'conflict' }
  | { state: 'integrity_failure' } | { state: 'unavailable' };

/**
 * Server-owned confirmation state. Pending approvals live only in this process;
 * the durable receipt is always checked before pending state or live freshness.
 */
export class ReviewManager {
  private readonly pending = new Map<string, ReviewIntent>();
  private serial: Promise<void> = Promise.resolve();

  constructor(private readonly store: ReviewStorePort) {}

  async prepare(draft: ReviewDraft): Promise<ReviewIntent> {
    let snapshot: ReviewSnapshot;
    try { snapshot = await this.store.readSnapshot(draft.subjectId, draft.decisionKey); }
    catch (error) { throw new ReviewError('graph_unavailable', 'Could not read complete review evidence', { cause: error }); }
    const intent = createReviewIntent(draft, snapshot);
    this.addPending(intent);
    return intent;
  }

  private addPending(intent: ReviewIntent): void {
    if (this.pending.has(intent.requestId)) throw new ReviewError('intent_conflict', 'Request ID already has a pending review');
    this.pending.set(intent.requestId, intent);
  }

  async status(requestId: string, expectedDigest: string): Promise<ReviewStatus> {
    const receipt = await this.store.lookupReceipt(requestId);
    if (receipt.state === 'unavailable') return { state: 'unavailable' };
    if (receipt.state === 'conflict') return { state: 'conflict' };
    if (receipt.state === 'integrity_failure') return { state: 'integrity_failure' };
    if (receipt.state === 'committed') {
      if (receipt.receipt.digest !== expectedDigest) return { state: 'conflict' };
      return this.classification(receipt.receipt.decisionId);
    }
    const intent = this.pending.get(requestId);
    if (!intent) return { state: 'absent' };
    return intent.digest === expectedDigest ? { state: 'pending', digest: intent.digest } : { state: 'conflict' };
  }

  async confirm(request: ConfirmRequest): Promise<ConfirmResult> {
    return this.withSerial(async () => {
      // Durable retry receipt precedes pending review, nonce, predecessor, and material checks.
      const receipt = await this.store.lookupReceipt(request.requestId);
      if (receipt.state === 'unavailable') throw new ReviewError('uncertain_write', 'Persisted request state is unavailable');
      if (receipt.state === 'integrity_failure') throw new ReviewError('integrity_failure', 'Persisted receipt is incomplete or inconsistent');
      if (receipt.state === 'conflict') throw new ReviewError('intent_conflict', 'Request ID has conflicting persisted receipts');
      if (receipt.state === 'committed') return this.resolveReceipt(receipt.receipt, request.expectedDigest);

      const intent = this.pending.get(request.requestId);
      if (!intent) throw new ReviewError('review_expired', 'Pending review expired or was never created');
      if (request.expectedDigest !== intent.digest) throw new ReviewError('intent_conflict', 'Submitted intent differs from server-owned review');
      if (!request.participantConfirmed || request.confirmationNonce !== intent.confirmationNonce) {
        throw new ReviewError('review_expired', 'Fresh participant confirmation is required');
      }
      let snapshot: ReviewSnapshot;
      try { snapshot = await this.store.readSnapshot(intent.subjectId, intent.decisionKey); }
      catch (error) { throw new ReviewError('uncertain_write', 'Current graph evidence is unavailable', { cause: error }); }
      if (!sameMaterial(snapshot, intent) || !['complete', 'absent'].includes(snapshot.lineageStatus)
        || snapshot.currentHeadId !== intent.expectedPredecessorId) {
        throw new ReviewError('stale_review', 'Decision head, lineage, or relevant material changed after review');
      }
      let commit: AtomicCommitResult;
      const { confirmationNonce: _nonce, createdAt: _createdAt, ...persistable } = intent;
      try { commit = await this.store.atomicCommit(persistable); }
      catch (error) { throw new ReviewError('uncertain_write', 'Save outcome is uncertain; reconcile the durable receipt', { cause: error }); }
      if (commit.state === 'stale') throw new ReviewError('stale_review', 'Atomic save rejected stale predecessor or material');
      if (commit.state === 'conflict') throw new ReviewError('intent_conflict', 'Atomic save rejected a duplicate request binding');
      if (commit.state === 'integrity_failure') throw new ReviewError('integrity_failure', 'Atomic save reported inconsistent receipt state');
      if (commit.state === 'uncertain') throw new ReviewError('uncertain_write', 'Save outcome is uncertain; reconcile the durable receipt');
      const after = await this.store.lookupReceipt(intent.requestId);
      if (after.state !== 'committed') throw new ReviewError('uncertain_write', 'Save completed without a verifiable durable receipt');
      const resolved = await this.resolveReceipt(after.receipt, intent.digest);
      this.pending.delete(intent.requestId);
      return resolved;
    });
  }

  private async resolveReceipt(receipt: PersistedReceipt, expectedDigest: string): Promise<ConfirmResult> {
    if (receipt.digest !== expectedDigest) throw new ReviewError('intent_conflict', 'Request ID was committed with different intent');
    if (!validReceipt(receipt)) {
      throw new ReviewError('integrity_failure', 'Persisted receipt is missing required decision bindings');
    }
    const classification = await this.store.classifyDecision(receipt.decisionId);
    if (classification === 'unavailable') throw new ReviewError('uncertain_write', 'Committed receipt exists but lineage classification is unavailable');
    if (classification === 'unknown') throw new ReviewError('integrity_failure', 'Committed decision is absent from complete lineage');
    return { state: 'committed', decisionId: receipt.decisionId, classification };
  }

  private async classification(decisionId: string): Promise<ReviewStatus> {
    const classification = await this.store.classifyDecision(decisionId);
    if (classification === 'unavailable') return { state: 'unavailable' };
    if (classification === 'unknown') return { state: 'integrity_failure' };
    return { state: 'committed', decisionId, classification };
  }

  private async withSerial<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.serial;
    let release!: () => void;
    this.serial = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  }
}

function sameMaterial(snapshot: ReviewSnapshot, intent: ReviewIntent): boolean {
  const allowedCitations = new Set(snapshot.validCitations.map((citation) => `${citation.revisionId}\u0000${citation.anchor}\u0000${citation.contentDigest}`));
  return snapshot.subjectId === intent.subjectId && snapshot.decisionKey === intent.decisionKey
    && canonicalBindings(snapshot.materialInventory) === canonicalBindings(intent.materialInventory)
    && canonicalBindings(snapshot.lineageInventory) === canonicalBindings(intent.lineageInventory)
    && intent.citations.every((citation) => allowedCitations.has(`${citation.revisionId}\u0000${citation.anchor}\u0000${citation.contentDigest}`));
}

function canonicalBindings(bindings: readonly (readonly string[])[]): string {
  return JSON.stringify([...bindings].map((binding) => [...binding]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
}

function validReceipt(receipt: PersistedReceipt): boolean {
  if (!receipt.decisionId || !receipt.aboutEdgeId || !receipt.requestId || !receipt.canonicalJson
    || createHash('sha256').update(receipt.canonicalJson).digest('hex') !== receipt.digest) return false;
  let stable: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(receipt.canonicalJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    stable = parsed as Record<string, unknown>;
  } catch { return false; }
  const citations = stable.citations;
  const predecessor = stable.expectedPredecessorId;
  return stable.requestId === receipt.requestId && stable.decisionId === receipt.decisionId
    && stable.subjectId === receipt.subjectId && stable.decisionKey === receipt.decisionKey
    && receipt.aboutEdgeId === `${receipt.decisionId}:about`
    && Array.isArray(citations) && receipt.citesEdgeIds.length === citations.length
    && receipt.citesEdgeIds.every((id, index) => id === `${receipt.decisionId}:cites:${index}`)
    && receipt.supersedesEdgeId === (typeof predecessor === 'string' ? `${receipt.decisionId}:supersedes` : null);
}
