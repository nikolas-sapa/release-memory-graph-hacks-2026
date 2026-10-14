import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GraphStore } from '../../src/graph/store.js';
import { projectEvidence } from '../../src/graph/queries.js';
import { generateFixture } from '../../fixtures/generate.js';

type Intent = 'impact' | 'prerequisites' | 'owners';
type Binding = { id: string; type: string; from: string; to: string; revision: string; source: string; anchor: string };
const ledger = readFileSync(new URL('../../fixtures/oracle-ledger.md', import.meta.url), 'utf8');
const manifest = JSON.parse(ledger.split('<!-- ORACLE_EDGE_MANIFEST_BEGIN -->')[1]!.split('```json')[1]!.split('```')[0]!) as Binding[];
const bindings = new Map(manifest.map((binding) => [binding.id, binding]));
const qRows = new Map([...ledger.matchAll(/^\| (Q\d{2}) \| ([^\n]+?) \|/gm)].map((row) => [row[1]!, [...row[2]!.matchAll(/`(edge:\d+)`/g)].map((edge) => edge[1]!)]));
const sid = (n: number) => `service:${String(n).padStart(3, '0')}`;
const cases: Array<{ id: string; target: number; intent: Intent; services: number[]; exclude?: number[] }> = [
  { id: 'Q01', target: 10, intent: 'impact', services: [10, 11] },
  { id: 'Q02', target: 21, intent: 'impact', services: [21, 22, 24] },
  { id: 'Q03', target: 30, intent: 'impact', services: [30, 31, 32, 33] },
  { id: 'Q04', target: 1, intent: 'impact', services: [1, 2, 3, 4, 5, 6] },
  { id: 'Q05', target: 1, intent: 'impact', services: [1, 2, 3, 4, 5, 6] },
  { id: 'Q06', target: 7, intent: 'impact', services: [7] },
  { id: 'Q07', target: 8, intent: 'impact', services: [8] },
  { id: 'Q08', target: 9, intent: 'owners', services: [9] },
  { id: 'Q09', target: 10, intent: 'impact', services: [10, 11] },
  { id: 'Q10', target: 12, intent: 'impact', services: [12, 13] },
  { id: 'Q11', target: 14, intent: 'owners', services: [14] },
  { id: 'Q12', target: 15, intent: 'impact', services: [15, 16] },
  { id: 'Q13', target: 17, intent: 'owners', services: [17], exclude: [18] },
  { id: 'Q14', target: 18, intent: 'impact', services: [18, 19], exclude: [20] },
  { id: 'Q15', target: 1, intent: 'impact', services: [1, 2, 3, 4, 5, 6] },
  { id: 'Q16', target: 22, intent: 'prerequisites', services: [21, 22], exclude: [24] },
  { id: 'Q17', target: 22, intent: 'impact', services: [22, 24], exclude: [21] },
  { id: 'Q18', target: 25, intent: 'impact', services: [25, 26, 27, 28, 29] },
  { id: 'Q19', target: 30, intent: 'impact', services: [30, 31, 32, 33] },
  { id: 'Q20', target: 30, intent: 'impact', services: [30, 31, 32, 33] },
];
const expectedMissingOwners: Record<string, string[]> = {
  Q04: ['service:001'], Q05: ['service:001'], Q10: ['service:012'],
  Q12: ['service:015', 'service:016'], Q15: ['service:001'],
};

test('dependency_20_paths_owners: 20/20 ledger cases, zero reversed or foreign facts (real FalkorDB)', async (t) => {
  const store = await GraphStore.connect({ url: 'redis://127.0.0.1:6379', graphName: 'release_memory', timeoutMs: 2000 });
  try {
    assert.equal(cases.length, 20);
    assert.equal(qRows.size, 20);
    for (const scenario of cases) await t.test(scenario.id, async () => {
      const report = await store.inspect(sid(scenario.target), scenario.intent);
      const missingOwners = expectedMissingOwners[scenario.id] ?? [];
      assert.equal(report.status, missingOwners.length > 0 ? 'incomplete' : 'complete', `${scenario.id} explicit retrieval status`);
      assert.deepEqual(report.gaps.filter((gap) => gap.code === 'missing_owner').map((gap) => gap.entityId).sort(), missingOwners, `${scenario.id} exact missing-owner gaps`);
      assert.equal(report.targetId, sid(scenario.target));
      assert.equal(report.intent, scenario.intent);
      assert.deepEqual([...report.entities.services].sort(), scenario.services.map(sid).sort());
      const fullProjectionIds = [...new Set(cases.filter((item) => item.target === scenario.target && item.intent === scenario.intent).flatMap((item) => qRows.get(item.id)!))].sort();
      assert.deepEqual(report.edges.map((edge) => edge.relationship_id).sort(), fullProjectionIds, `${scenario.id} zero foreign projected edges`);
      const projectedBindings = fullProjectionIds.map((edgeId) => bindings.get(edgeId)!);
      assert.deepEqual([...report.entities.projects].sort(), [...new Set(projectedBindings.filter((edge) => edge.type === 'USES').map((edge) => edge.from))].sort());
      assert.deepEqual([...report.entities.owners].sort(), [...new Set(projectedBindings.filter((edge) => edge.type === 'OWNS').map((edge) => edge.from))].sort());
      for (const n of scenario.exclude ?? []) assert.ok(!report.entities.services.includes(sid(n)));
      for (const edgeId of qRows.get(scenario.id)!) {
        const expected = bindings.get(edgeId)!;
        assert.ok(expected, `${scenario.id} has frozen binding ${edgeId}`);
        const actual = report.edges.find((edge) => edge.relationship_id === edgeId);
        assert.ok(actual, `${scenario.id} returned ${edgeId}`);
        assert.equal(actual.type, expected.type);
        assert.equal(actual.source_id_endpoint, expected.from);
        assert.equal(actual.target_id, expected.to);
        assert.equal(actual.document_revision_id, expected.revision);
        assert.equal(actual.source_id, expected.source);
        assert.equal(actual.anchor, expected.anchor);
        assert.ok(report.facts.some((fact) => fact.predicate === expected.type && fact.subjectId === expected.from && fact.objectId === expected.to && fact.edgeIds.includes(edgeId)), `${edgeId} authoritative directed fact`);
        if (expected.type === 'OWNS') assert.ok(report.entities.owners.includes(expected.from));
        if (expected.type === 'USES') assert.ok(report.entities.projects.includes(expected.from));
        const source = await store.source(report.requestId, expected.revision, expected.anchor);
        assert.equal(source.revisionId, expected.revision);
        assert.equal(source.anchor, expected.anchor);
        assert.ok(source.excerpt.includes(`${expected.from} ${expected.type} ${expected.to}`), `${edgeId} exact anchored entailment`);
      }
      const routePresent = (route: string[]) => report.paths.some((path) => {
        const sequence = path.edgeIds.join('|');
        return sequence.includes(route.join('|'));
      });
      if (scenario.id === 'Q04') for (const route of [
        ['edge:0001', 'edge:0004'],
        ['edge:0006', 'edge:0005'],
        ['edge:0001', 'edge:0002', 'edge:0005'],
        ['edge:0006', 'edge:0003'],
      ]) assert.ok(routePresent(route), `diamond path ${route.join(' → ')} retained`);
      if (['Q03', 'Q19', 'Q20'].includes(scenario.id)) assert.ok(routePresent(['edge:0019', 'edge:0020', 'edge:0021']), 'three-hop consumer path retained');
      if (scenario.id === 'Q18') assert.ok(routePresent(['edge:0014', 'edge:0018', 'edge:0017', 'edge:0016']), 'cycle-adjacent four-hop consumer path retained');
      for (const path of report.paths) {
        assert.equal(path.nodeIds.length, path.edgeIds.length + 1);
        for (const [index, edgeId] of path.edgeIds.entries()) {
          const edge = report.edges.find((item) => item.relationship_id === edgeId);
          assert.ok(edge, `path edge ${edgeId} exists`);
          const incomingDependency = scenario.intent === 'impact' && edge.type === 'DEPENDS_ON';
          assert.equal(path.nodeIds[index], incomingDependency ? edge.target_id : edge.source_id_endpoint, `${edgeId} exact intent-directed start`);
          assert.equal(path.nodeIds[index + 1], incomingDependency ? edge.source_id_endpoint : edge.target_id, `${edgeId} exact intent-directed end`);
        }
      }
      if (scenario.id === 'Q11') assert.deepEqual([...report.entities.owners].sort(), ['person:012', 'person:013']);
      if (scenario.id === 'Q12') {
        assert.equal(report.status, 'incomplete');
        assert.ok(report.gaps.some((gap) => gap.code === 'missing_owner' && gap.entityId === 'service:016'));
      }
      if (scenario.id === 'Q18') assert.ok(report.gaps.some((gap) => gap.code === 'dependency_cycle'));
      if (scenario.id === 'Q15') assert.equal(report.entities.owners.filter((owner) => owner === 'person:040').length, 1);
    });
  } finally { await store.close(); }
});

test('E11 overflow and E25 empty graph: 2/2 bounded pure projections, zero baseline mutations', () => {
  const fixture = generateFixture();
  const provider = fixture.records.find((record) => record.semantic_id === 'service:010')!;
  const consumer = fixture.records.find((record) => record.semantic_id === 'service:011')!;
  const template = fixture.edges.find((edge) => edge.relationship_id === 'edge:0008')!;
  const consumers = Array.from({ length: 101 }, (_, index) => ({ ...consumer, semantic_id: `service:overlay-${index}` }));
  const edges = consumers.map((record, index) => ({ ...template, relationship_id: `edge:overlay-${index}`, source_id_endpoint: record.semantic_id }));
  const projected = projectEvidence({ requestId: 'overflow', targetId: provider.semantic_id, intent: 'impact', records: [provider, ...consumers], edges, depth: 6, pathCap: 100 });
  assert.equal(projected.limits?.overflow, true);
  assert.equal(projected.completeness.paths, false);
  assert.equal(projected.paths?.length, 100);
  assert.equal(projected.edges.length, 101);
  assert.throws(() => projectEvidence({ requestId: 'empty', targetId: 'service:010', intent: 'impact', records: [], edges: [], depth: 6, pathCap: 100 }), /unknown_target/);
});

test('frontier proof 1/1 and empty accepted inventory 2/2: explicit evidence without invented expansion/current head', () => {
  const fixture = generateFixture();
  const frontier = projectEvidence({ requestId: 'frontier-proof', targetId: 'service:034', intent: 'impact', records: fixture.records, edges: fixture.edges, depth: 6, pathCap: 100 });
  const boundary = fixture.edges.find((edge) => edge.relationship_id === 'edge:0028')!;
  assert.equal(boundary.source_id_endpoint, 'service:041');
  assert.equal(boundary.target_id, 'service:040');
  assert.equal(frontier.status, 'incomplete');
  assert.deepEqual(frontier.limits.frontierIds, ['service:041']);
  assert.ok(frontier.gaps.some((gap) => gap.code === 'unexpanded_frontier' && gap.edgeId === boundary.relationship_id && gap.entityId === 'service:041'));
  assert.ok(!frontier.entities.services.includes('service:041'));
  assert.ok(frontier.paths.every((path) => !path.nodeIds.includes('service:041') && !path.edgeIds.includes(boundary.relationship_id)));
  const fact = frontier.facts.find((item) => item.predicate === 'DEPENDS_ON' && item.subjectId === 'service:041' && item.objectId === 'service:040' && item.edgeIds.includes(boundary.relationship_id));
  assert.ok(fact);
  const proof = fact.sources.find((source) => source.revisionId === boundary.document_revision_id && source.anchor === boundary.anchor);
  assert.ok(proof);
  assert.equal(proof.sourceId, boundary.source_id);
  assert.ok(proof.excerpt.includes(`At ${boundary.anchor}, fictional review asserts service:041 DEPENDS_ON service:040`));
  for (const intent of ['current_rationale', 'history'] as const) {
    const absent = projectEvidence({ requestId: `absent-${intent}`, targetId: 'service:280', intent, records: fixture.records, edges: fixture.edges });
    assert.equal(absent.status, 'complete');
    assert.equal(absent.completeness.lineage, true);
    assert.ok(absent.gaps.some((gap) => gap.code === 'no_accepted_decisions' && gap.entityId === 'service:280'));
    assert.deepEqual(absent.decisions, []);
    assert.equal(absent.facts.filter((item) => ['ABOUT', 'CITES', 'SUPERSEDES'].includes(item.predicate)).length, 0);
  }
});

test('adversity_retrieval_subset: terminal/frontier 2/2, provider direction 4/4, isolated target 1/1, source rejects 2/2', async () => {
  const store = await GraphStore.connect({ url: 'redis://127.0.0.1:6379', graphName: 'release_memory', timeoutMs: 2000 });
  try {
    const terminal = await store.inspect('service:030', 'impact', { depth: 3, pathCap: 100 });
    assert.equal(terminal.completeness.traversal, true);
    assert.deepEqual(terminal.limits.frontierIds, []);
    const frontier = await store.inspect('service:034', 'impact', { depth: 6, pathCap: 100 });
    assert.equal(frontier.status, 'incomplete');
    assert.equal(frontier.completeness.traversal, false);
    assert.deepEqual(frontier.limits.frontierIds, ['service:041']);
    assert.ok(frontier.gaps.some((gap) => gap.code === 'unexpanded_frontier' && gap.edgeId === 'edge:0028' && gap.entityId === 'service:041'));
    assert.ok(!frontier.entities.services.includes('service:041'));
    assert.ok(frontier.paths.every((path) => !path.nodeIds.includes('service:041')));
    assert.ok(frontier.facts.some((fact) => fact.predicate === 'DEPENDS_ON' && fact.subjectId === 'service:041' && fact.objectId === 'service:040' && fact.edgeIds.includes('edge:0028') && fact.sources.length >= 1));
    const impact = await store.inspect('service:022', 'impact');
    const prerequisites = await store.inspect('service:022', 'prerequisites');
    assert.deepEqual([...impact.entities.services].sort(), ['service:022', 'service:024']);
    assert.deepEqual([...prerequisites.entities.services].sort(), ['service:021', 'service:022']);
    assert.deepEqual(prerequisites.entities.projects, []);
    const providerOnlyImpact = await store.inspect('service:013', 'impact');
    const providerOnlyPrerequisites = await store.inspect('service:013', 'prerequisites');
    assert.deepEqual(providerOnlyImpact.entities.services, ['service:013']);
    assert.deepEqual([...providerOnlyPrerequisites.entities.services].sort(), ['service:012', 'service:013']);
    const isolated = await store.inspect('service:023', 'impact');
    assert.equal(isolated.status, 'complete');
    assert.deepEqual(isolated.entities.services, ['service:023']);
    assert.deepEqual(isolated.entities.owners, ['person:021']);
    assert.deepEqual(isolated.entities.projects, []);
    const owners = await store.inspect('service:009', 'owners');
    assert.deepEqual(owners.entities.projects, []);
    assert.deepEqual(owners.entities.owners, ['person:008']);
    await assert.rejects(store.source(owners.requestId, 'document:207', 'section-01/paragraph-01'));
    await assert.rejects(store.source('unreturned-request', 'document:041', 'section-07/paragraph-06'));
    await assert.rejects(store.inspect('service:030', 'impact', { depth: 7, pathCap: 100 }));
    await assert.rejects(store.inspect('service:030', 'impact', { depth: 6, pathCap: 101 }));
  } finally { await store.close(); }
});
