import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { generateFixture, GENERATOR_VERSION, SEED } from '../../fixtures/generate.js';

const fixture = generateFixture();
const expectedNodes = { Person: 120, Project: 100, Service: 280, Ticket: 180, Document: 220, Decision: 100 };
const expectedEdges = { OWNS: 420, USES: 1000, DEPENDS_ON: 700, AFFECTS: 220, ABOUT: 100, CITES: 360, SUPERSEDES: 60, REVISES: 140 };

test('baseline has exact selected semantic node and relationship budgets', () => {
  assert.equal(fixture.records.length, 1000);
  assert.equal(fixture.edges.length, 3000);
  for (const [type, count] of Object.entries(expectedNodes)) assert.equal(fixture.records.filter((record) => record.type === type).length, count, type);
  for (const [type, count] of Object.entries(expectedEdges)) assert.equal(fixture.edges.filter((edge) => edge.type === type).length, count, type);
});

test('IDs are stable, unique, typed, and every directed edge has valid typed endpoints and provenance', () => {
  const records = new Map(fixture.records.map((record) => [record.semantic_id, record]));
  assert.equal(records.size, fixture.records.length);
  assert.equal(new Set(fixture.edges.map((edge) => edge.relationship_id)).size, fixture.edges.length);
  const domains: Record<string, string[]> = {
    OWNS: ['Person', 'Project|Service'], USES: ['Project', 'Service'], DEPENDS_ON: ['Service', 'Service'],
    AFFECTS: ['Ticket', 'Project|Service'], ABOUT: ['Decision', 'Project|Service|Ticket'],
    CITES: ['Decision', 'Document'], SUPERSEDES: ['Decision', 'Decision'], REVISES: ['Document', 'Document'],
  };
  for (const edge of fixture.edges) {
    const from = records.get(edge.source_id_endpoint), to = records.get(edge.target_id);
    assert.ok(from, `${edge.relationship_id} source exists`); assert.ok(to, `${edge.relationship_id} target exists`);
    assert.ok(domains[edge.type]?.[0]?.split('|').includes(from.type), `${edge.type} source type`);
    assert.ok(domains[edge.type]?.[1]?.split('|').includes(to.type), `${edge.type} target type`);
    assert.ok(records.has(edge.document_revision_id));
    assert.equal(records.get(edge.document_revision_id)?.type, 'Document');
    assert.equal(records.get(edge.document_revision_id)?.source_id, edge.source_id);
    assert.ok(String(records.get(edge.document_revision_id)?.content).includes(`${edge.source_id_endpoint} ${edge.type} ${edge.target_id}`));
    assert.ok(edge.source_id.length > 0 && edge.anchor.length > 0 && edge.asserted_at.endsWith('Z'));
    assert.ok(['current', 'stale', 'unknown'].includes(edge.validity_state));
    assert.ok(['reviewed', 'unreviewed', 'disputed'].includes(edge.review_state));
  }
});

test('accepted decision topology is forty disjoint acyclic linear chains', () => {
  const decisions = fixture.records.filter((record) => record.type === 'Decision');
  const records = new Map(fixture.records.map((record) => [record.semantic_id, record]));
  const links = fixture.edges.filter((edge) => edge.type === 'SUPERSEDES');
  assert.equal(links.length, 60);
  assert.ok(decisions.every((record) => record.state === 'accepted'));
  const next = new Map(links.map((edge) => [edge.source_id_endpoint, edge.target_id]));
  assert.equal(next.size, 60);
  const seen = new Set<string>(); let roots = 0;
  for (const decision of decisions) {
    if (next.has(decision.semantic_id)) continue;
    roots++;
    let cursor = decision.semantic_id; const local = new Set<string>();
    while (true) {
      assert.ok(!local.has(cursor), `cycle at ${cursor}`); local.add(cursor); seen.add(cursor);
      const predecessor = links.find((edge) => edge.target_id === cursor)?.source_id_endpoint; if (!predecessor) break; cursor = predecessor;
    }
  }
  assert.equal(roots, 40); assert.equal(seen.size, 100);
  assert.ok(links.every((edge) => edge.acceptance_state === 'accepted' && edge.reviewer_id && edge.reviewed_at));
  for (const edge of links) assert.equal(records.get(edge.source_id_endpoint)?.scope_subject_id, records.get(edge.target_id)?.scope_subject_id);
  const scopes = new Set(decisions.map((record) => `${String(record.scope_subject_id)}|${String(record.decision_key)}`));
  assert.equal(scopes.size, 40);
  for (const key of scopes) {
    const group = decisions.filter((record) => `${String(record.scope_subject_id)}|${String(record.decision_key)}` === key);
    assert.ok(group.length === 2 || group.length === 3);
    assert.equal(links.filter((edge) => group.some((record) => record.semantic_id === edge.source_id_endpoint)).length, group.length - 1);
  }
});

test('document topology is eighty disjoint unbranched acyclic source lineages', () => {
  const documents = fixture.records.filter((record) => record.type === 'Document');
  const links = fixture.edges.filter((edge) => edge.type === 'REVISES');
  assert.equal(links.length, 140);
  const sourceIds = new Set(documents.map((document) => document.source_id));
  assert.equal(sourceIds.size, 80);
  for (const sourceId of sourceIds) {
    const group = documents.filter((document) => document.source_id === sourceId);
    const groupIds = new Set(group.map((document) => document.semantic_id));
    const groupEdges = links.filter((edge) => groupIds.has(edge.source_id_endpoint) || groupIds.has(edge.target_id));
    assert.equal(groupEdges.length, group.length - 1);
    assert.equal(group.length === 2 || group.length === 3, true);
    const parents = groupEdges.filter((edge) => groupIds.has(edge.target_id));
    const children = groupEdges.filter((edge) => groupIds.has(edge.source_id_endpoint));
    assert.ok(parents.every((edge) => groupIds.has(edge.source_id_endpoint)));
    assert.ok(children.every((edge) => groupIds.has(edge.target_id)));
    assert.ok(group.every((document) => document.origin === 'synthetic'));
    const newest = group.find((document) => !links.some((edge) => edge.target_id === document.semantic_id));
    assert.ok(newest);
    const reached = new Set<string>(); let cursor = newest.semantic_id;
    while (!reached.has(cursor)) { reached.add(cursor); const previous = links.find((edge) => edge.source_id_endpoint === cursor)?.target_id; if (!previous) break; cursor = previous; }
    assert.equal(reached.size, group.length);
  }
});

test('seed and generator version produce identical sorted serialized data and digest', () => {
  assert.equal(fixture.seed, SEED); assert.equal(fixture.generator_version, GENERATOR_VERSION);
  const second = generateFixture(SEED);
  assert.equal(second.canonical_json, fixture.canonical_json);
  assert.equal(second.sha256, fixture.sha256);
  assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.records[0]?.semantic_id, 'decision:001');
  assert.equal(fixture.edges[0]?.relationship_id, 'edge:0001');
});

test('curated incoming, prerequisite, ownership, joint-owner, unknown-owner, cycle, and terminal cases match oracle IDs', () => {
  const relation = (type: string, from: string, to: string) => fixture.edges.find((edge) => edge.type === type && edge.source_id_endpoint === from && edge.target_id === to)?.relationship_id;
  assert.equal(relation('DEPENDS_ON', 'service:011', 'service:010'), 'edge:0008');
  assert.deepEqual(['edge:0012', 'edge:0013'], fixture.edges.filter((edge) => edge.type === 'DEPENDS_ON' && ['service:022', 'service:024'].includes(edge.source_id_endpoint) && ['service:021', 'service:022'].includes(edge.target_id)).map((edge) => edge.relationship_id));
  assert.equal(relation('DEPENDS_ON', 'service:022', 'service:021'), 'edge:0012');
  assert.deepEqual(['edge:0310', 'edge:0311'], fixture.edges.filter((edge) => edge.type === 'OWNS' && edge.target_id === 'service:014').map((edge) => edge.relationship_id));
  assert.equal(fixture.edges.some((edge) => edge.type === 'OWNS' && edge.target_id === 'service:016'), false);
  assert.equal(relation('DEPENDS_ON', 'service:025', 'service:026'), 'edge:0015');
  assert.equal(relation('DEPENDS_ON', 'service:026', 'service:025'), 'edge:0014');
  assert.deepEqual(['edge:0019', 'edge:0020', 'edge:0021'], fixture.edges.filter((edge) => edge.type === 'DEPENDS_ON' && ['service:031', 'service:032', 'service:033'].includes(edge.source_id_endpoint) && ['service:030', 'service:031', 'service:032'].includes(edge.target_id)).map((edge) => edge.relationship_id));
});

test('every accepted decision keeps a cited immutable synthetic revision with its rationale text', () => {
  const records = new Map(fixture.records.map((record) => [record.semantic_id, record]));
  const decisions = fixture.records.filter((record) => record.type === 'Decision');
  for (const decision of decisions) {
    const citations = fixture.edges.filter((edge) => edge.type === 'CITES' && edge.source_id_endpoint === decision.semantic_id);
    assert.ok(citations.length > 0, `${decision.semantic_id} citation`);
    assert.ok(citations.some((edge) => String(records.get(edge.target_id)?.content).includes(String(decision.rationale))));
  }
});

test('every Q/L oracle row binds exact current fixture edges, endpoints, and provenance', () => {
  const ledger = readFileSync(fileURLToPath(new URL('../../fixtures/oracle-ledger.md', import.meta.url)), 'utf8');
  const rows = [...ledger.matchAll(/^\| (Q\d{2}|L\d{2}) \|.*$/gm)].map(([line, id]) => ({ id: id!, edges: [...line.matchAll(/edge:\d{4}/g)].map(([edgeId]) => edgeId) }));
  assert.equal(rows.filter((row) => row.id.startsWith('Q')).length, 20);
  assert.equal(rows.filter((row) => row.id.startsWith('L')).length, 10);
  const manifestText = ledger.match(/<!-- ORACLE_EDGE_MANIFEST_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- ORACLE_EDGE_MANIFEST_END -->/)?.[1];
  assert.ok(manifestText, 'Q/L edge binding manifest exists');
  const manifest = JSON.parse(manifestText) as Array<{ id: string; type: string; from: string; to: string; revision: string; anchor: string; source: string; validity: string }>;
  const expectedById = new Map(manifest.map((binding) => [binding.id, binding]));
  assert.equal(expectedById.size, manifest.length);
  assert.equal(manifest.length, 121, 'frozen Q/L oracle has 121 unique current edge bindings');
  assert.deepEqual(new Set(rows.flatMap((row) => row.edges)), new Set(expectedById.keys()), 'manifest and Q/L references match exactly');
  const fixtureById = new Map(fixture.edges.map((edge) => [edge.relationship_id, edge]));
  const records = new Map(fixture.records.map((record) => [record.semantic_id, record]));
  for (const row of rows) for (const id of row.edges) {
    const expected = expectedById.get(id), actual = fixtureById.get(id);
    assert.ok(expected, `${row.id} manifest includes ${id}`);
    assert.ok(actual, `${row.id} fixture includes ${id}`);
    assert.equal(actual.type, expected.type, `${row.id} ${id} type`);
    assert.equal(actual.source_id_endpoint, expected.from, `${row.id} ${id} direction/source`);
    assert.equal(actual.target_id, expected.to, `${row.id} ${id} target`);
    assert.equal(actual.document_revision_id, expected.revision, `${row.id} ${id} immutable revision`);
    assert.equal(actual.anchor, expected.anchor, `${row.id} ${id} anchor`);
    assert.equal(actual.source_id, expected.source, `${row.id} ${id} logical source`);
    assert.equal(actual.validity_state, expected.validity, `${row.id} ${id} recorded validity`);
    assert.equal(actual.validity_state, 'current', `${row.id} ${id} oracle evidence is current`);
    assert.equal(records.get(actual.document_revision_id)?.source_id, actual.source_id, `${row.id} ${id} source/revision binding`);
    assert.ok(String(records.get(actual.document_revision_id)?.content).includes(`${actual.source_id_endpoint} ${actual.type} ${actual.target_id}`), `${row.id} ${id} cited anchor supports exact edge`);
  }
  const q18 = rows.find((row) => row.id === 'Q18')!;
  const expectedQ18Dependencies = q18.edges.filter((id) => fixtureById.get(id)?.type === 'DEPENDS_ON').sort();
  const reachedEdges = new Set<string>(), visitedServices = new Set(['service:025']), queue = ['service:025'];
  while (queue.length) {
    const provider = queue.shift()!;
    for (const edge of fixture.edges.filter((candidate) => candidate.type === 'DEPENDS_ON' && candidate.target_id === provider)) {
      reachedEdges.add(edge.relationship_id);
      if (!visitedServices.has(edge.source_id_endpoint)) { visitedServices.add(edge.source_id_endpoint); queue.push(edge.source_id_endpoint); }
    }
  }
  assert.deepEqual([...reachedEdges].sort(), expectedQ18Dependencies, 'Q18 lists complete incoming reachability, including edges 0016/0017');
});
