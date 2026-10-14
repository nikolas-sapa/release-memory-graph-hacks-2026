import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { FalkorDB } from 'falkordb';

// SHORTCUT: isolated fixed synthetic graph/container only. Never run against an application graph.
const graphName = 'g01_falkordb_spike';
const containerName = 'graph-hacks-g01-falkordb';
const imageDigest = 'sha256:92fbda814970a648b1fd80835bff221766bccd0f0ce958bc58a62976fea06620';
const volumeName = 'graph-hacks-2026-g01-data';
const results = [];
let verifiedServer;
function report() {
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ actualTime: new Date().toISOString(), graphName,
    client: 'falkordb@6.8.0', serverModuleVersion: verifiedServer?.moduleVersion,
    serverArchitecture: verifiedServer?.architecture, serverRunId: verifiedServer?.runId,
    image: `falkordb/falkordb@${imageDigest}`, volume: volumeName, results,
    priorFailure: 'First immediate reconnect after docker restart crashed with unhandled SocketClosedUnexpectedlyError before FalkorDB.connect returned.',
    unproved: ['application exclusive-writer access boundary, participant approval/nonce/restart expiry',
      'full per-intent material inventory and full accepted-chain validation',
      'network/queue wall-clock deadline, host/power-loss durability',
      'worker containment of factory SocketClosedUnexpectedlyError, separate from safely caught ECONNREFUSED'] }, null, 2) + '\n');
}
function verifyContainerIdentity() {
  const raw = execFileSync('docker', ['--context', 'colima', 'inspect', containerName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const [container] = JSON.parse(raw);
  assert.ok(container, 'G01 container must exist');
  assert.equal(container.Name, `/${containerName}`);
  assert.equal(container.State.Status, 'running');
  assert.equal(container.Image, imageDigest, 'G01 container must use pinned image digest');
  assert.deepEqual(container.HostConfig.PortBindings['6379/tcp'], [{ HostIp: '127.0.0.1', HostPort: '6379' }]);
  assert.equal(container.Mounts.filter(mount => mount.Type === 'volume' && mount.Destination === '/var/lib/falkordb/data').length, 1);
  assert.equal(container.Mounts.find(mount => mount.Destination === '/var/lib/falkordb/data')?.Name, volumeName);
  return container.Id;
}
async function serverReady() {
  const start = performance.now();
  while (performance.now() - start < 5000) {
    try {
      const response = execFileSync('docker', ['--context', 'colima', 'exec', containerName, 'redis-cli', 'PING'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 });
      if (response.trim() === 'PONG') return;
    } catch {}
    await delay(100);
  }
  throw new Error('isolated server not ready within 5000 ms');
}
let db;
let graph;
async function connect() {
  const containerId = verifyContainerIdentity();
  const expectedInfo = execFileSync('docker', ['--context', 'colima', 'exec', containerName, 'redis-cli', 'INFO', 'server'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const expectedRunId = expectedInfo.match(/^run_id:([^\r\n]+)/m)?.[1];
  assert.ok(expectedRunId, 'isolated Redis run_id must be available');
  db = await FalkorDB.connect({ host: '127.0.0.1', port: 6379,
    socket: { connectTimeout: 2000, reconnectStrategy: false }, disableOfflineQueue: true });
  db.on('error', () => {}); // SHORTCUT: tests capture query rejection, production needs sanitized error reporting.
  graph = db.selectGraph(graphName);
  const rawClient = await db.connection;
  const actualInfo = await rawClient.sendCommand(['INFO', 'server']);
  const actualRunId = actualInfo.match(/^run_id:([^\r\n]+)/m)?.[1];
  assert.equal(actualRunId, expectedRunId, 'SDK connection must reach the verified G01 container');
  const modules = await rawClient.sendCommand(['INFO', 'modules']);
  const moduleVersion = Number(modules.match(/^module:name=graph,ver=(\d+)/m)?.[1]);
  assert.equal(moduleVersion, 60000, 'FalkorDB graph module version must match tested server');
  const serverInfo = await rawClient.sendCommand(['INFO', 'server']);
  verifiedServer = { containerId, runId: actualRunId, moduleVersion,
    architecture: serverInfo.match(/^os:.*\s(aarch64|x86_64|arm64|x64)$/m)?.[1] ?? 'unknown' };
}
async function check(name, run) {
  const start = performance.now();
  try {
    const evidence = await run();
    results.push({ name, passed: true, elapsedMs: Math.round(performance.now() - start), evidence });
  } catch (error) {
    results.push({ name, passed: false, elapsedMs: Math.round(performance.now() - start), error: error.message });
    process.exitCode = 1;
  }
  report();
  console.log(JSON.stringify(results.at(-1)));
}
const query = (cypher, params = {}) => graph.query(cypher, { params, TIMEOUT: 2000 });
const read = (cypher, params = {}) => graph.roQuery(cypher, { params, TIMEOUT: 2000 });
async function counts() {
  const nodes = await read('MATCH (n) RETURN count(n) AS count');
  const edges = await read('MATCH ()-[r]->() RETURN count(r) AS count');
  return [nodes.data[0].count, edges.data[0].count];
}
async function shape() {
  const result = await read('MATCH (s:Service {id:$subject})-[r:USES]->(d:Document {id:$document}) RETURN s,r,d',
    { subject: 'g01-service', document: 'g01-doc' });
  assert.equal(result.data.length, 1);
  const { s, r, d } = result.data[0];
  assert.deepEqual([s.properties.id, r.properties.id, d.properties.id], ['g01-service', 'g01-edge', 'g01-doc']);
  assert.equal(r.sourceId, s.id);
  assert.equal(r.destinationId, d.id);
  assert.equal(r.relationshipType, 'USES');
  return { stableIds: [s.properties.id, r.properties.id, d.properties.id], rawNodeIds: [s.id, d.id], rawEdgeId: r.id };
}
const baselineInventory = [['g01-edge', 'g01-service', 'g01-doc', 'USES', { id: 'g01-edge' }]];
async function inventory() {
  return (await read(`MATCH (s:Service {id:$subject}) OPTIONAL MATCH (s)-[r]-(other)
    WHERE type(r) IN ['DEPENDS_ON','OWNS','USES'] WITH r,other ORDER BY r.id,other.id
    RETURN collect(DISTINCT CASE WHEN r IS NULL THEN null ELSE
      [r.id,startNode(r).id,endNode(r).id,type(r),properties(r)] END) AS inventory`, { subject: 'g01-service' })).data[0].inventory;
}
function intent(request, predecessor = null, text = 'Accepted synthetic rationale', materialInventory = baselineInventory) {
  // SHORTCUT: explicit fixed intent fields. Production canonicalization/schema version owned by application.
  const binding = { version: 1, request, subject: 'g01-service', key: 'release', text,
    rationale: 'Synthetic G01 evidence', reviewer: 'g01-test', predecessor,
    document: 'g01-doc', documentDigest: 'g01-content-v1', materialVersion: 'g01-material-v1', materialInventory };
  const json = JSON.stringify(binding);
  return { ...binding, json, digest: createHash('sha256').update(json).digest('hex'), id: `g01-decision-${request}` };
}
async function receipt(i) {
  const result = await read(`MATCH (d:Decision {request_id:$request})
    OPTIONAL MATCH (d)-[a:ABOUT]->(s:Service)
    OPTIONAL MATCH (d)-[c:CITES]->(doc:Document)
    OPTIONAL MATCH (d)-[p:SUPERSEDES]->(prior:Decision)
    RETURN d, collect(DISTINCT a) AS about, collect(DISTINCT s) AS subjects,
      collect(DISTINCT c) AS cites, collect(DISTINCT doc) AS documents,
      collect(DISTINCT p) AS supersedes, collect(DISTINCT prior) AS priors`, { request: i.request });
  if (result.data.length === 0) return null;
  assert.equal(result.data.length, 1, 'integrity failure: duplicate receipt nodes');
  const row = result.data[0];
  if (row.d.properties.intent_digest !== i.digest || row.d.properties.intent_json !== i.json) throw new Error('intent_conflict');
  assert.equal(row.d.properties.status, 'accepted');
  assert.equal(row.d.properties.id, i.id);
  assert.deepEqual(row.about.map(e => e.properties.id), [`${i.id}:about`]);
  assert.deepEqual(row.cites.map(e => e.properties.id), [`${i.id}:cites`]);
  assert.deepEqual(row.subjects.map(n => n.properties.id), [i.subject]);
  assert.deepEqual(row.documents.map(n => n.properties.id), [i.document]);
  assert.deepEqual(row.priors.map(n => n.properties.id), i.predecessor === null ? [] : [i.predecessor]);
  assert.deepEqual(row.supersedes.map(e => e.properties.id), i.predecessor === null ? [] : [`${i.id}:supersedes`]);
  return row.d.properties.id;
}
async function commit(i, slow = false) {
  // PROVES: matching receipt resolved before obsolete live predecessor/material checks, with no write command.
  const previous = await receipt(i);
  if (previous !== null) return previous;
  // SHORTCUT: simple valid two-node scope. Full accepted-chain validation is later application work.
  // MISSING: production pending review/nonce/approval and exclusive-writer access boundary.
  const result = await query(`MATCH (s:Service {id:$subject,material_version:$materialVersion}),
      (doc:Document {id:$document,content_digest:$documentDigest})
    OPTIONAL MATCH (s)-[material]-(other) WHERE type(material) IN ['DEPENDS_ON','OWNS','USES']
    WITH s,doc,material,other ORDER BY material.id,other.id
    WITH s,doc,collect(DISTINCT CASE WHEN material IS NULL THEN null ELSE
      [material.id,startNode(material).id,endNode(material).id,type(material),properties(material)] END) AS actualInventory
    WHERE actualInventory=$materialInventory
    OPTIONAL MATCH (h:Decision {subject_id:$subject,decision_key:$key,status:'accepted'})
    WHERE NOT (h)<-[:SUPERSEDES]-(:Decision {status:'accepted'})
    WITH s,doc,collect(h) AS heads
    WHERE ($predecessor IS NULL AND size(heads)=0)
      OR ($predecessor IS NOT NULL AND size(heads)=1 AND heads[0].id=$predecessor)
    OPTIONAL MATCH (existing:Decision {request_id:$request})
    WITH s,doc,heads,existing WHERE existing IS NULL
    CREATE (d:Decision {id:$id,status:'accepted',request_id:$request,intent_version:$version,
      intent_digest:$digest,intent_json:$json,subject_id:$subject,decision_key:$key,
      text:$text,rationale:$rationale,reviewer:$reviewer,expected_predecessor:$predecessor,
      document_id:$document,document_digest:$documentDigest,material_version:$materialVersion})
    CREATE (d)-[:ABOUT {id:$aboutId}]->(s)
    CREATE (d)-[:CITES {id:$citesId,anchor:'g01-anchor'}]->(doc)
    FOREACH (h IN heads | CREATE (d)-[:SUPERSEDES {id:$supersedesId}]->(h))
    ${slow ? 'WITH d UNWIND range(1,10000) AS x UNWIND range(1,10000) AS y RETURN d.id AS id,sum(sin(toFloat(x*y))) AS expensive' : 'RETURN d.id AS id'}`,
    { ...i, aboutId: `${i.id}:about`, citesId: `${i.id}:cites`, supersedesId: `${i.id}:supersedes` });
  if (result.data.length === 0) throw new Error('stale_review');
  assert.equal(result.data.length, 1);
  assert.equal(await receipt(i), i.id);
  return i.id;
}

await connect();
// SHORTCUT: reset only the explicitly named isolated throwaway graph, preserving all other graphs/resources.
assert.equal(verifiedServer.containerId, verifyContainerIdentity(), 'G01 target changed before graph reset');
await query('MATCH (n) DETACH DELETE n');
await query(`CREATE (s:Service {id:'g01-service',material_version:'g01-material-v1'}),
  (d:Document {id:'g01-doc',content_digest:'g01-content-v1',anchor:'g01-anchor'})
  CREATE (s)-[:USES {id:'g01-edge'}]->(d)`);
await check('shape_stable_ids', shape);
await check('parameter_literal', async () => {
  const text = '"}) CREATE (:Ticket {id:"injection"}) // \\ Ω\nend';
  const result = await read('RETURN $text AS text', { text });
  assert.equal(result.data[0].text, text);
  assert.equal((await read('MATCH (n:Ticket {id:$id}) RETURN count(n) AS count', { id: 'injection' })).data[0].count, 0);
  return { exactRoundtrip: true, injectedNodes: 0 };
});
await check('read_timeout', async () => {
  const start = performance.now();
  await assert.rejects(read('UNWIND range(1,10000) AS x UNWIND range(1,10000) AS y RETURN sum(sin(toFloat(x*y))) AS expensive'), /timed? ?out|timeout/i);
  const elapsedMs = Math.round(performance.now() - start);
  assert.ok(elapsedMs <= 3000);
  return { requestedTimeoutMs: 2000, elapsedMs };
});
await check('runtime_failure_rollback', async () => {
  const before = await counts();
  await assert.rejects(query(`CREATE (n:Decision {id:$id,request_id:$request,status:'accepted'})
    WITH n MATCH (s:Service {id:'g01-service'}),(d:Document {id:'g01-doc'})
    CREATE (n)-[:ABOUT {id:'rollback-about'}]->(s)
    CREATE (n)-[:CITES {id:'rollback-cites'}]->(d)
    WITH n RETURN 1/0 AS failure`, { id: 'g01-rollback', request: 'g01-rollback-request' }), /Division by zero/);
  assert.deepEqual(await counts(), before);
  assert.equal((await read('MATCH (n:Decision {id:$id}) RETURN count(n) AS count', { id: 'g01-rollback' })).data[0].count, 0);
  return { partialNodes: 0, partialEdges: 0 };
});
const first = intent('g01-request-1');
const second = intent('g01-request-2', first.id, 'Replacing synthetic rationale');
await check('accepted_commit_complete', async () => ({ id: await commit(first), counts: await counts() }));
await check('receipt_first_retry', async () => {
  const before = await counts();
  assert.equal(await commit(first), first.id);
  assert.equal(await commit(first), first.id);
  assert.deepEqual(await counts(), before);
  await commit(second);
  const afterAdvance = await counts();
  // PROVES: original acknowledged/lost-ack binding survives subsequent head advancement.
  assert.equal(await commit(first), first.id);
  assert.deepEqual(await counts(), afterAdvance);
  return { originalId: first.id, replacingId: second.id, additionalRetryWrites: 0 };
});
await check('changed_intent_conflict', async () => {
  const before = await counts();
  await assert.rejects(commit(intent(first.request, null, 'Altered rationale')), /intent_conflict/);
  assert.deepEqual(await counts(), before);
  return { mutations: 0 };
});
await check('stale_new_request', async () => {
  const before = await counts();
  await assert.rejects(commit(intent('g01-stale', first.id)), /stale_review/);
  assert.deepEqual(await counts(), before);
  return { mutations: 0 };
});
await check('connect_refused_safely_rejected', async () => {
  const stdout = execFileSync(process.execPath, [new URL('./connect-probe.mjs', import.meta.url).pathname, '6398'],
    { timeout: 3000, stdio: 'pipe', encoding: 'utf8' });
  assert.deepEqual(JSON.parse(stdout), { status: 'unavailable', code: 'ECONNREFUSED' });
  return { childExitCode: 0, observed: 'ECONNREFUSED caught by connection factory await/catch' };
});
await check('worker_refusal_and_read_recovery', async () => {
  async function probe(port) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./connect-probe.mjs', import.meta.url), { workerData: { port } });
      let settled = false;
      const timer = setTimeout(() => {
        void worker.terminate();
        finish(() => reject(new Error('worker exceeded 2000 ms deadline')));
      }, 2000);
      function finish(action) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      }
      worker.once('error', error => finish(() => reject(error)));
      worker.once('message', message => finish(() => resolve(message)));
      worker.once('exit', code => finish(() => reject(new Error(`worker exited ${code} without a result`))));
    });
  }
  const unavailable = await probe(6398);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.code, 'ECONNREFUSED');
  const recovered = await probe(6379);
  assert.equal(recovered.status, 'available');
  assert.equal(recovered.nodes, (await counts())[0]);
  return { refused: unavailable, recovered, parentAlive: true, graphWrites: 0 };
});
for (let restart = 1; restart <= 2; restart++) {
  await check(`durable_restart_${restart}`, async () => {
    const before = await counts();
    await db.close();
    execFileSync('docker', ['--context', 'colima', 'restart', containerName], { stdio: 'pipe', timeout: 15000 });
    await serverReady();
    await connect();
    const evidence = await shape();
    assert.equal(await commit(first), first.id);
    assert.equal(await receipt(second), second.id);
    assert.deepEqual(await counts(), before);
    return { ...evidence, receiptIds: [first.id, second.id], sameVolume: true };
  });
}
const lostAck = intent('g01-lost-ack', second.id, 'Committed before caller discarded acknowledgment');
await check('committed_lost_ack_retry', async () => {
  // PROVES: actual complete graph commit exists before caller deliberately discards its acknowledgment.
  await assert.rejects((async () => { await commit(lostAck); throw new Error('deliberately discarded acknowledgment'); })(), /discarded acknowledgment/);
  const before = await counts();
  assert.equal(await commit(lostAck), lostAck.id);
  assert.equal(await commit(lostAck), lostAck.id);
  assert.deepEqual(await counts(), before);
  return { actualCommittedId: lostAck.id, sameIdRetries: 2, additionalWrites: 0 };
});
await check('interrupted_inflight_write', async () => {
  const interrupted = intent('g01-interrupted', lostAck.id, 'Interrupted real query');
  const before = await counts();
  let settled = false;
  const pending = commit(interrupted, true).then(value => ({ kind: 'committed', value }), error => ({ kind: 'uncertain', error: error.message }))
    .finally(() => { settled = true; });
  await delay(150);
  assert.equal(settled, false, 'save must still be in flight before server kill');
  execFileSync('docker', ['--context', 'colima', 'kill', '--signal', 'KILL', containerName], { stdio: 'pipe', timeout: 5000 });
  const transportOutcome = await pending;
  try { await db.close(); } catch {}
  execFileSync('docker', ['--context', 'colima', 'start', containerName], { stdio: 'pipe', timeout: 5000 });
  await serverReady();
  await connect();
  assert.equal(verifiedServer.containerId, verifyContainerIdentity(), 'G01 target changed before recovery inspection');
  const stored = await receipt(interrupted);
  const after = await counts();
  const completeDelta = [1, 3];
  if (stored === null) assert.deepEqual(after, before);
  else {
    assert.equal(stored, interrupted.id);
    assert.deepEqual(after, before.map((n, idx) => n + completeDelta[idx]));
    assert.equal(await commit(interrupted), interrupted.id);
    assert.deepEqual(await counts(), after);
  }
  return { killAfterMs: 150, transportOutcome, persistedBranch: stored === null ? 'absent' : 'complete',
    partialNodes: 0, partialEdges: 0, samePersistentVolume: true };
});
await check('material_inventory_add_change_delete_zero_write', async () => {
  const unchangedRevision = (await read('MATCH (d:Document {id:$id}) RETURN d.content_digest AS digest', { id: 'g01-doc' })).data[0].digest;
  const reviewedBeforeAdd = intent('g01-material-add', lostAck.id, 'Before material addition', await inventory());
  await query(`CREATE (p:Service {id:'g01-provider'}) WITH p MATCH (s:Service {id:'g01-service'})
    CREATE (s)-[:DEPENDS_ON {id:'g01-dependency',document_id:'g01-doc',anchor:'g01-anchor'}]->(p)`);
  const afterAdd = await counts();
  await assert.rejects(commit(reviewedBeforeAdd), /stale_review/);
  assert.deepEqual(await counts(), afterAdd);
  const reviewedBeforeChange = intent('g01-material-change', lostAck.id, 'Before property change', await inventory());
  await query(`MATCH ()-[r:DEPENDS_ON {id:'g01-dependency'}]->() SET r.anchor='changed-anchor'`);
  const afterChange = await counts();
  await assert.rejects(commit(reviewedBeforeChange), /stale_review/);
  assert.deepEqual(await counts(), afterChange);
  const reviewedBeforeDelete = intent('g01-material-delete', lostAck.id, 'Before material deletion', await inventory());
  await query(`MATCH ()-[r:DEPENDS_ON {id:'g01-dependency'}]->() DELETE r`);
  const afterDelete = await counts();
  await assert.rejects(commit(reviewedBeforeDelete), /stale_review/);
  assert.deepEqual(await counts(), afterDelete);
  const reviewedBeforeOwner = intent('g01-material-owner', lostAck.id, 'Before new owner', await inventory());
  await query(`CREATE (p:Person {id:'g01-owner'}) WITH p MATCH (s:Service {id:'g01-service'})
    CREATE (p)-[:OWNS {id:'g01-ownership',document_id:'g01-doc',anchor:'g01-anchor'}]->(s)`);
  const afterOwner = await counts();
  await assert.rejects(commit(reviewedBeforeOwner), /stale_review/);
  assert.deepEqual(await counts(), afterOwner);
  // PROVES: durable receipt resolution ignores obsolete material inventory for an already complete commit.
  assert.equal(await commit(first), first.id);
  assert.deepEqual(await counts(), afterOwner);
  assert.equal((await read('MATCH (d:Document {id:$id}) RETURN d.content_digest AS digest', { id: 'g01-doc' })).data[0].digest, unchangedRevision);
  return { changedCases: ['dependency addition', 'dependency property change', 'dependency deletion', 'owner addition'],
    rejectedNewWrites: 4, partialWrites: 0, documentRevisionUnchanged: true, matchingOldReceiptWrites: 0 };
});
await db.close();
report();
