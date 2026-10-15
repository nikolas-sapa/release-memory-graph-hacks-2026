import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewError, type ReviewDraft, type ReviewSnapshot } from '../../src/memory/review.js';
import { ReviewManager, type AtomicCommitResult, type PersistedReceipt, type PersistableReviewIntent, type ReceiptLookup, type ReviewStorePort } from '../../src/memory/save.js';

const citation = { revisionId: 'document:010', anchor: 'section-01/paragraph-01', contentDigest: 'a'.repeat(64) };
const draft: ReviewDraft = { subjectId: 'service:010', decisionKey: 'release', text: 'Retain service', rationale: 'Cited live graph material supports retention.', reviewerId: 'person:010', citations: [citation] };

class DurableTestStore implements ReviewStorePort {
  current: ReviewSnapshot = { subjectId: 'service:010', decisionKey: 'release', currentHeadId: null, lineageStatus: 'absent',
    materialInventory: [['edge:010', 'OWNS', 'person:010', 'service:010']], lineageInventory: [], validCitations: [citation] };
  receipts = new Map<string, PersistedReceipt>();
  classifications = new Map<string, 'current' | 'historical' | 'unknown' | 'unavailable'>();
  writeCount = 0;
  simulate: 'normal' | 'lose_ack_after_commit' | 'uncertain_absent' = 'normal';
  async lookupReceipt(requestId: string): Promise<ReceiptLookup> { const receipt = this.receipts.get(requestId); return receipt ? { state: 'committed', receipt } : { state: 'absent' }; }
  async readSnapshot(): Promise<ReviewSnapshot> { return structuredClone(this.current); }
  async atomicCommit(intent: PersistableReviewIntent): Promise<AtomicCommitResult> {
    this.writeCount++;
    if (this.simulate === 'uncertain_absent') return { state: 'uncertain' };
    this.receipts.set(intent.requestId, { requestId: intent.requestId, decisionId: intent.decisionId, digest: intent.digest,
      canonicalJson: intent.canonicalJson, subjectId: intent.subjectId, decisionKey: intent.decisionKey,
      aboutEdgeId: `${intent.decisionId}:about`, citesEdgeIds: intent.citations.map((_, index) => `${intent.decisionId}:cites:${index}`),
      supersedesEdgeId: intent.expectedPredecessorId ? `${intent.decisionId}:supersedes` : null });
    this.classifications.set(intent.decisionId, 'current');
    this.current = { ...this.current, currentHeadId: intent.decisionId, lineageStatus: 'complete' };
    return this.simulate === 'lose_ack_after_commit' ? { state: 'uncertain' } : { state: 'created' };
  }
  async classifyDecision(decisionId: string) { return this.classifications.get(decisionId) ?? 'unknown'; }
}

const confirmation = (intent: Awaited<ReturnType<ReviewManager['prepare']>>) => ({ requestId: intent.requestId, expectedDigest: intent.digest,
  confirmationNonce: intent.confirmationNonce, participantConfirmed: true });

test('interrupted_save_zero_partial_state 2/2: uncertainty reconciles only absent or complete atomic state', async (t) => {
  await t.test('commit landed before lost acknowledgment: complete receipt, exact links, zero retry writes', async () => {
    const store = new DurableTestStore(); store.simulate = 'lose_ack_after_commit';
    const firstProcess = new ReviewManager(store); const intent = await firstProcess.prepare(draft);
    await assert.rejects(firstProcess.confirm(confirmation(intent)), (error: unknown) => error instanceof ReviewError && error.code === 'uncertain_write');
    const countsAfterCommit = [store.receipts.size, store.writeCount];
    const afterRestart = new ReviewManager(store);
    const reconciled = await afterRestart.confirm(confirmation(intent));
    assert.deepEqual(reconciled, { state: 'committed', decisionId: intent.decisionId, classification: 'current' });
    assert.deepEqual([store.receipts.size, store.writeCount], countsAfterCommit);
    const receipt = store.receipts.get(intent.requestId)!;
    assert.ok(receipt.aboutEdgeId); assert.equal(receipt.citesEdgeIds.length, 1);
  });
  await t.test('absent branch: no partial receipt, old review expires, fresh review creates once', async () => {
    const store = new DurableTestStore(); store.simulate = 'uncertain_absent';
    const firstProcess = new ReviewManager(store); const oldIntent = await firstProcess.prepare(draft);
    await assert.rejects(firstProcess.confirm(confirmation(oldIntent)), (error: unknown) => error instanceof ReviewError && error.code === 'uncertain_write');
    assert.equal(store.receipts.has(oldIntent.requestId), false);
    const afterRestart = new ReviewManager(store);
    assert.deepEqual(await afterRestart.status(oldIntent.requestId, oldIntent.digest), { state: 'absent' });
    await assert.rejects(afterRestart.confirm(confirmation(oldIntent)), (error: unknown) => error instanceof ReviewError && error.code === 'review_expired');
    store.simulate = 'normal';
    const renewed = await afterRestart.prepare(draft);
    assert.notEqual(renewed.requestId, oldIntent.requestId);
    const result = await afterRestart.confirm(confirmation(renewed));
    assert.deepEqual(result, { state: 'committed', decisionId: renewed.decisionId, classification: 'current' });
    assert.equal(store.receipts.size, 1); assert.equal(store.writeCount, 2);
  });
});

test('E16 lost acknowledgment after confirmed commit 1/1: same-ID status and retry, zero duplicate write', async () => {
  const store = new DurableTestStore(); store.simulate = 'lose_ack_after_commit';
  const firstProcess = new ReviewManager(store); const intent = await firstProcess.prepare(draft);
  await assert.rejects(firstProcess.confirm(confirmation(intent)), (error: unknown) => error instanceof ReviewError && error.code === 'uncertain_write');
  const secondProcess = new ReviewManager(store);
  assert.deepEqual(await secondProcess.status(intent.requestId, intent.digest), { state: 'committed', decisionId: intent.decisionId, classification: 'current' });
  const count = store.writeCount;
  assert.deepEqual(await secondProcess.confirm(confirmation(intent)), { state: 'committed', decisionId: intent.decisionId, classification: 'current' });
  assert.equal(store.writeCount, count);
});

test('two identical submissions resolve one same-ID decision and required link set 1/1', async () => {
  const store = new DurableTestStore(); const manager = new ReviewManager(store); const intent = await manager.prepare(draft);
  const request = confirmation(intent);
  const results = await Promise.all([manager.confirm(request), manager.confirm(request)]);
  assert.equal(results[0]?.decisionId, intent.decisionId);
  assert.deepEqual(results[1], results[0]);
  assert.equal(store.writeCount, 1);
  assert.equal(store.receipts.get(intent.requestId)?.citesEdgeIds.length, 1);
});

test('expired pending reviews never reconstruct approval from client data 1/1', async () => {
  const store = new DurableTestStore(); const oldProcess = new ReviewManager(store); const intent = await oldProcess.prepare(draft);
  const afterRestart = new ReviewManager(store);
  await assert.rejects(afterRestart.confirm(confirmation(intent)), (error: unknown) => error instanceof ReviewError && error.code === 'review_expired');
  assert.equal(store.writeCount, 0);
});
