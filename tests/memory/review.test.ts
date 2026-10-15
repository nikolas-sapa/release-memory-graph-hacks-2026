import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewError, type ReviewDraft, type ReviewSnapshot } from '../../src/memory/review.js';
import { ReviewManager, type AtomicCommitResult, type PersistedReceipt, type PersistableReviewIntent, type ReceiptLookup, type ReviewStorePort } from '../../src/memory/save.js';

const citation = { revisionId: 'document:010', anchor: 'section-01/paragraph-01', contentDigest: 'a'.repeat(64) };
const baseDraft: ReviewDraft = { subjectId: 'service:010', decisionKey: 'release', text: 'Retain service', rationale: 'Current dependency evidence supports retention.', reviewerId: 'person:010', citations: [citation] };

function snapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  return { subjectId: 'service:010', decisionKey: 'release', currentHeadId: null, lineageStatus: 'absent',
  materialInventory: [['edge:010', 'OWNS', 'person:010', 'service:010']], lineageInventory: [], validCitations: [citation], ...overrides };
}

class FakeStore implements ReviewStorePort {
  current = snapshot();
  receipts = new Map<string, PersistedReceipt>();
  classes = new Map<string, 'current' | 'historical' | 'unknown' | 'unavailable'>();
  snapshotReads = 0;
  writes = 0;
  nextCommit: 'created' | 'stale' | 'uncertain_after_commit' | 'uncertain_absent' = 'created';

  async lookupReceipt(requestId: string): Promise<ReceiptLookup> {
    const receipt = this.receipts.get(requestId);
    return receipt ? { state: 'committed', receipt } : { state: 'absent' };
  }

  async readSnapshot(): Promise<ReviewSnapshot> { this.snapshotReads++; return structuredClone(this.current); }

  async atomicCommit(intent: PersistableReviewIntent): Promise<AtomicCommitResult> {
    this.writes++;
    if (this.nextCommit === 'stale') return { state: 'stale' };
    if (this.nextCommit === 'uncertain_absent') return { state: 'uncertain' };
    const receipt: PersistedReceipt = {
      requestId: intent.requestId, decisionId: intent.decisionId, digest: intent.digest, canonicalJson: intent.canonicalJson,
      subjectId: intent.subjectId, decisionKey: intent.decisionKey, aboutEdgeId: `${intent.decisionId}:about`,
      citesEdgeIds: intent.citations.map((_, index) => `${intent.decisionId}:cites:${index}`),
      supersedesEdgeId: intent.expectedPredecessorId ? `${intent.decisionId}:supersedes` : null,
    };
    this.receipts.set(intent.requestId, receipt);
    this.classes.set(intent.decisionId, 'current');
    this.current = { ...this.current, currentHeadId: intent.decisionId, lineageStatus: 'complete' };
    return this.nextCommit === 'uncertain_after_commit' ? { state: 'uncertain' } : { state: 'created' };
  }

  async classifyDecision(decisionId: string) { return this.classes.get(decisionId) ?? 'unknown'; }
}

function confirmed(intent: Awaited<ReturnType<ReviewManager['prepare']>>, overrides: Partial<{ confirmationNonce: string; expectedDigest: string; participantConfirmed: boolean }> = {}) {
  return { requestId: intent.requestId, expectedDigest: intent.digest, confirmationNonce: intent.confirmationNonce,
    participantConfirmed: true, ...overrides };
}

test('stale_review_zero_write 1/1: changed material rejects before atomic write', async () => {
  const store = new FakeStore(); const manager = new ReviewManager(store); const intent = await manager.prepare(baseDraft);
  store.current = snapshot({ materialInventory: [['edge:010', 'OWNS', 'person:010', 'service:010'], ['edge:011', 'DEPENDS_ON', 'service:010', 'service:011']] });
  await assert.rejects(manager.confirm(confirmed(intent)), (error: unknown) => error instanceof ReviewError && error.code === 'stale_review');
  assert.equal(store.writes, 0);
});

test('committed_retry_receipt_before_stale_checks 1/1: matching receipt wins before changed graph checks', async () => {
  const store = new FakeStore(); const manager = new ReviewManager(store); const intent = await manager.prepare(baseDraft);
  const first = await manager.confirm(confirmed(intent)); const reads = store.snapshotReads;
  store.current = snapshot({ currentHeadId: 'decision:advanced', lineageStatus: 'complete', materialInventory: [['changed']] });
  const retry = await manager.confirm(confirmed(intent, { confirmationNonce: 'expired-and-ignored', participantConfirmed: false }));
  assert.deepEqual(retry, first); assert.equal(store.snapshotReads, reads); assert.equal(store.writes, 1);
});

test('retry_after_scope_advances_returns_historical_id 1/1: committed decision is not mislabeled current', async () => {
  const store = new FakeStore(); const manager = new ReviewManager(store); const intent = await manager.prepare(baseDraft);
  await manager.confirm(confirmed(intent));
  store.classes.set(intent.decisionId, 'historical');
  const retry = await manager.confirm(confirmed(intent));
  assert.deepEqual(retry, { state: 'committed', decisionId: intent.decisionId, classification: 'historical' });
  assert.equal(store.writes, 1);
});

test('changed_intent_same_id_conflict 1/1: a durable request cannot be rebound', async () => {
  const store = new FakeStore(); const manager = new ReviewManager(store); const intent = await manager.prepare(baseDraft);
  await manager.confirm(confirmed(intent));
  await assert.rejects(manager.confirm(confirmed(intent, { expectedDigest: 'f'.repeat(64) })),
    (error: unknown) => error instanceof ReviewError && error.code === 'intent_conflict');
  assert.equal(store.writes, 1);
});

test('stale nonce 1/1: old or incorrect confirmation nonce causes zero writes', async () => {
  const store = new FakeStore(); const manager = new ReviewManager(store); const intent = await manager.prepare(baseDraft);
  await assert.rejects(manager.confirm(confirmed(intent, { confirmationNonce: 'old' })),
    (error: unknown) => error instanceof ReviewError && error.code === 'review_expired');
  assert.equal(store.writes, 0);
});

test('review requires exact complete lineage, current source citation, and bounded reviewed text 3/3', async (t) => {
  await t.test('incomplete lineage', async () => {
    const store = new FakeStore(); store.current = snapshot({ lineageStatus: 'incomplete' });
    await assert.rejects(new ReviewManager(store).prepare(baseDraft), /complete lineage/);
  });
  await t.test('unreviewed source revision', async () => {
    const store = new FakeStore();
    await assert.rejects(new ReviewManager(store).prepare({ ...baseDraft, citations: [{ ...citation, contentDigest: 'b'.repeat(64) }] }), /immutable source/);
  });
  await t.test('oversize rationale', async () => {
    const store = new FakeStore();
    await assert.rejects(new ReviewManager(store).prepare({ ...baseDraft, rationale: 'x'.repeat(8193) }), /scope, text/);
  });
});
