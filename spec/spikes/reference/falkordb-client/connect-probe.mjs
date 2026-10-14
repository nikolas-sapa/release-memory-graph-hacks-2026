import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FalkorDB } from 'falkordb';

// PROVES: ordinary refused connection safely rejects; worker can report read-only recovery.
// SHORTCUT: fixed read-only count probe; production query allowlist/deadlines remain application work.
const port = isMainThread ? Number(process.argv[2]) : workerData.port;
try {
  const db = await FalkorDB.connect({ host: '127.0.0.1', port,
    socket: { connectTimeout: 1000, reconnectStrategy: false }, disableOfflineQueue: true });
  db.on('error', () => {});
  const result = await db.selectGraph('g01_falkordb_spike').roQuery('MATCH (n) RETURN count(n) AS count', { TIMEOUT: 2000 });
  await db.close();
  const message = { status: 'available', nodes: result.data[0].count };
  if (parentPort) parentPort.postMessage(message);
  else console.log(JSON.stringify(message));
} catch (error) {
  // MISSING: initial restart separately exposed unhandled SocketClosedUnexpectedlyError before factory returned.
  if (parentPort) parentPort.postMessage({ status: 'unavailable', code: error.code });
  else console.log(JSON.stringify({ status: 'unavailable', code: error.code }));
}
