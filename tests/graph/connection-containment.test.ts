import assert from 'node:assert/strict';
import test from 'node:test';
import type { FalkorDB } from 'falkordb';
import { connectFalkorDBSafely, GraphStoreError } from '../../src/graph/store.js';

test('startup socket error 1/1 maps graph_unavailable and removes temporary listener after settle', async () => {
  const before = process.rawListeners('uncaughtException');
  const socketError = new Error('simulated socket closed during connect');
  socketError.name = 'SocketClosedUnexpectedlyError';
  let temporaryListeners = 0;
  const pending = connectFalkorDBSafely(() => {
    const added = process.rawListeners('uncaughtException').filter((listener) => !before.includes(listener));
    temporaryListeners = added.length;
    assert.equal(added.length, 1);
    // Invoke the newly installed listener directly, preserving node:test's own
    // uncaught-exception listener and avoiding a genuine process-wide failure.
    added[0]!(socketError, 'uncaughtException');
    return new Promise<FalkorDB>(() => {});
  });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof GraphStoreError);
    assert.equal(error.code, 'graph_unavailable');
    assert.equal(error.cause, socketError);
    return true;
  });
  assert.equal(temporaryListeners, 1);
  assert.deepEqual(process.rawListeners('uncaughtException'), before);
});

test('ordinary connection rejection 1/1 preserves exact error for GraphStore mapping and removes listener', async () => {
  const before = process.rawListeners('uncaughtException');
  const connectionError = new Error('simulated connection refused');
  await assert.rejects(connectFalkorDBSafely(() => Promise.reject(connectionError)), (error: unknown) => {
    assert.equal(error, connectionError);
    return true;
  });
  assert.deepEqual(process.rawListeners('uncaughtException'), before);
});
