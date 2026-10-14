import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateFixture } from '../../fixtures/generate.js';
import { GraphStore } from '../../src/graph/store.js';
import { validateLineage } from '../../src/graph/lineage.js';
import type { DecisionEvidence } from '../../src/contracts.js';

const fixture = generateFixture();
const ledger = readFileSync(new URL('../../fixtures/oracle-ledger.md', import.meta.url), 'utf8');
const rows = [...ledger.matchAll(/^\| (L\d{2}) \| decision:(\d+) \/ decision:(\d+); ([^|]+) \| ([^\n]+) \|/gm)];
const id = (kind: string, n: number) => `${kind}:${String(n).padStart(3, '0')}`;

test('lineage_10_prior_replacing_current: 10/10 real graph scopes, exact prior/head/cited revision bindings', async (t) => {
  const store = await GraphStore.connect({ url: 'redis://127.0.0.1:6379', graphName: 'release_memory', timeoutMs: 2000 });
  try {
    assert.equal(rows.length, 10);
    for (const [index, row] of rows.entries()) await t.test(row[1]!, async () => {
      const priorId = id('decision', Number(row[2]));
      const headId = id('decision', Number(row[3]));
      const subjectId = id('service', index + 1);
      const decisionKey = `scope-${String(index + 1).padStart(3, '0')}`;
      const history = await store.inspect(subjectId, 'history');
      const current = await store.inspect(subjectId, 'current_rationale');
      const group = history.decisions.find((scope) => scope.decisionKey === decisionKey);
      assert.ok(group);
      assert.equal(group.subjectId, subjectId);
      assert.equal(group.status, 'complete');
      assert.equal(group.headId, headId);
      assert.equal(group.decisions.length, 3);
      assert.equal(group.decisions.find((decision) => decision.id === priorId)?.state, 'historical');
      assert.equal(group.decisions.find((decision) => decision.id === headId)?.state, 'current');
      assert.equal(current.decisions.find((scope) => scope.decisionKey === decisionKey)?.headId, headId);
      for (const edgeId of [...row[4]!.matchAll(/`(edge:\d+)`/g)].map((match) => match[1]!)) assert.ok(history.edges.some((edge) => edge.relationship_id === edgeId));
      const cited = [...row[5]!.matchAll(/`(edge:\d+) → (document:\d+) \(source:\d+\)`/g)];
      assert.equal(cited.length, 2);
      for (const binding of cited) {
        const edge = history.edges.find((item) => item.relationship_id === binding[1]);
        assert.ok(edge);
        assert.equal(edge.target_id, binding[2]);
        const decision: DecisionEvidence | undefined = group.decisions.find((item) => item.id === edge.source_id_endpoint);
        assert.ok(decision);
        assert.ok(decision.citationRevisionIds.includes(binding[2]!));
        assert.ok(decision.rationale.includes(decision.state === 'current' ? 'resolved' : 'unresolved'));
        const citedSource = await store.source(history.requestId, binding[2]!, edge.anchor);
        assert.equal(citedSource.revisionId, binding[2]);
        assert.ok(citedSource.excerpt.includes(`Synthetic rationale anchor ${edge.anchor}: ${decision.rationale}`));
      }
    });
  } finally { await store.close(); }
});

test('adversity_lineage_subset: 6/6 corrupt/incomplete inventories select zero current heads', () => {
  const base = { subjectId: 'service:001', decisionKey: 'scope-001', records: structuredClone(fixture.records), edges: structuredClone(fixture.edges) };
  const valid = validateLineage(base);
  assert.equal(valid.status, 'complete');
  assert.equal(valid.headId, 'decision:003');
  assert.deepEqual(valid.orderedIds, ['decision:003', 'decision:002', 'decision:001']);
  const check = (name: string, mutate: (input: typeof base) => void, status: 'conflict' | 'incomplete' = 'conflict') => {
    const input = structuredClone(base); mutate(input);
    const result = validateLineage(input);
    assert.equal(result.status, status, name);
    assert.equal(result.headId, null, `${name}: zero selected heads`);
  };
  const template = fixture.edges.find((edge) => edge.relationship_id === 'edge:0041')!;
  check('E08 accepted cycle', (input) => input.edges.push({ ...template, relationship_id: 'overlay:cycle', source_id_endpoint: 'decision:001', target_id: 'decision:003' }));
  check('E09 two accepted successors', (input) => { input.edges.find((edge) => edge.relationship_id === 'edge:0044')!.target_id = 'decision:001'; });
  const incomplete = validateLineage({ ...base, inventoryComplete: false });
  assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.headId, null);
  check('E17 disconnected cycle beside valid head', (input) => {
    const first = { ...input.records.find((record) => record.semantic_id === 'decision:001')!, semantic_id: 'decision:901' };
    const second = { ...first, semantic_id: 'decision:902' };
    input.records.push(first, second);
    const about = input.edges.find((edge) => edge.type === 'ABOUT' && edge.source_id_endpoint === 'decision:001')!;
    input.edges.push(
      { ...about, relationship_id: 'overlay:about-first', source_id_endpoint: first.semantic_id },
      { ...about, relationship_id: 'overlay:about-second', source_id_endpoint: second.semantic_id },
      { ...template, relationship_id: 'overlay:disconnected-a', source_id_endpoint: first.semantic_id, target_id: second.semantic_id },
      { ...template, relationship_id: 'overlay:disconnected-b', source_id_endpoint: second.semantic_id, target_id: first.semantic_id },
    );
  });
  check('E20 cross-scope supersession', (input) => input.edges.push({ ...template, relationship_id: 'overlay:cross', source_id_endpoint: 'decision:003', target_id: 'decision:006' }));
  check('E20 ABOUT subject mismatch', (input) => { input.edges.find((edge) => edge.type === 'ABOUT' && edge.source_id_endpoint === 'decision:003')!.target_id = 'service:002'; });
  const absent = validateLineage({ ...base, subjectId: 'service:280', decisionKey: 'absent' });
  assert.equal(absent.status, 'absent'); assert.equal(absent.headId, null);
});

test('stale accepted lineage links 2/2: ABOUT and SUPERSEDES select zero current heads', () => {
  for (const type of ['ABOUT', 'SUPERSEDES'] as const) {
    const input = { subjectId: 'service:001', decisionKey: 'scope-001', records: structuredClone(fixture.records), edges: structuredClone(fixture.edges) };
    const edge = input.edges.find((item) => item.type === type && item.source_id_endpoint === 'decision:003')!;
    assert.ok(edge, `${type} accepted baseline link`);
    edge.validity_state = 'stale';
    const result = validateLineage(input);
    assert.notEqual(result.status, 'complete', `${type} stale inventory is not complete`);
    assert.notEqual(result.status, 'absent', `${type} stale inventory is not absence`);
    assert.equal(result.headId, null, `${type} stale link selects zero current heads`);
  }
});
