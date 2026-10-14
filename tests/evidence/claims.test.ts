import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { generateFixture } from '../../fixtures/generate.js';
import type { SemanticRecord } from '../../fixtures/generate.js';
import { GraphStore } from '../../src/graph/store.js';
import { assembleEvidence } from '../../src/evidence/assemble.js';

const fixture = generateFixture();
const claimEdges = ['edge:0001', 'edge:0008', 'edge:0012', 'edge:0013', 'edge:0304', 'edge:0307', 'edge:0308', 'edge:0310', 'edge:0311', 'edge:0728'];
test('claims_10_edge_revision_entailment: 10/10 authoritative facts bind exact directed edge and immutable anchored assertion', async () => {
  const store = await GraphStore.connect({ url: 'redis://127.0.0.1:6379', graphName: 'release_memory', timeoutMs: 2000 });
  try {
    const reports = await Promise.all(['service:001', 'service:007', 'service:010', 'service:014', 'service:021'].map((target) => store.inspect(target, 'impact')));
    assert.equal(claimEdges.length, 10);
    for (const edgeId of claimEdges) {
      const edge = fixture.edges.find((item) => item.relationship_id === edgeId)!;
      const report = reports.find((item) => item.edges.some((itemEdge) => itemEdge.relationship_id === edgeId));
      assert.ok(report, `${edgeId} returned by actual query`);
      const fact = report.facts.find((item) => item.edgeIds.includes(edgeId) && item.predicate === edge.type && item.subjectId === edge.source_id_endpoint && item.objectId === edge.target_id);
      assert.ok(fact, `${edgeId} exact fact endpoint/type`);
      const proof = fact.sources.find((source) => source.revisionId === edge.document_revision_id && source.anchor === edge.anchor);
      assert.ok(proof, `${edgeId} exact proof`);
      assert.equal(proof.sourceId, edge.source_id);
      const document = fixture.records.find((record) => record.semantic_id === edge.document_revision_id)!;
      assert.equal(proof.contentDigest, createHash('sha256').update(String(document.content)).digest('hex'));
      const source = await store.source(report.requestId, proof.revisionId, proof.anchor);
      assert.equal(source.excerpt, proof.excerpt);
      assert.ok(source.excerpt.includes(`At ${edge.anchor}, fictional review asserts ${edge.source_id_endpoint} ${edge.type} ${edge.target_id}`));
    }
  } finally { await store.close(); }
});

test('adversity_evidence_subset: 8/8 invalid proofs yield gaps/conflicts and zero unsupported owner facts', () => {
  const owner = fixture.edges.find((edge) => edge.relationship_id === 'edge:0307')!;
  const records = fixture.records.filter((record) => [owner.source_id_endpoint, owner.target_id, owner.document_revision_id].includes(record.semantic_id));
  const base = { requestId: 'assembly-proof', targetId: 'service:010', intent: 'owners' as const, records, edges: [owner] };
  const valid = assembleEvidence(base);
  assert.equal(valid.facts.filter((fact) => fact.predicate === 'OWNS').length, 1);
  const check = (name: string, mutate: (input: typeof base) => void) => {
    const input = structuredClone(base); mutate(input);
    const report = assembleEvidence(input);
    assert.ok(report.status === 'incomplete' || report.status === 'conflict', name);
    assert.ok(report.gaps.length > 0, `${name}: explicit gap/conflict`);
    assert.equal(report.facts.filter((fact) => fact.predicate === 'OWNS').length, 0, `${name}: zero unsupported owner facts`);
  };
  check('E03 stale owner evidence', (input) => { input.edges[0]!.validity_state = 'stale'; });
  check('E04 missing immutable source revision', (input) => { input.records = input.records.filter((record) => record.type !== 'Document'); });
  check('E06 citation exists but does not entail ownership', (input) => {
    const doc = input.records.find((record) => record.type === 'Document')!;
    doc.content = `At ${owner.anchor}, fictional review asserts service:011 DEPENDS_ON service:010 with current validity and reviewed review state.`;
    doc.content_digest = createHash('sha256').update(String(doc.content)).digest('hex');
  });
  check('E22 duplicate immutable revision identity', (input) => { input.records.push(structuredClone(input.records.find((record) => record.type === 'Document')!)); });
  check('E23 logical source alone', (input) => { input.edges[0]!.document_revision_id = ''; });
  check('E24 nonexistent immutable revision', (input) => { input.edges[0]!.document_revision_id = 'document:999'; });
  check('E24 dangling anchor', (input) => { input.edges[0]!.anchor = 'nonexistent-anchor'; });
  check('E24 changed content digest', (input) => { input.records.find((record) => record.type === 'Document')!.content_digest = '0'.repeat(64); });
});

test('E02 exclusive owners and E05 conflicting revision identities: 2/2 conflicts, zero chosen owners', () => {
  const owner = fixture.edges.find((edge) => edge.relationship_id === 'edge:0307')!;
  const originalDoc = fixture.records.find((record) => record.semantic_id === owner.document_revision_id)!;
  const input = {
    requestId: 'exclusive-proof', targetId: 'service:010', intent: 'owners' as const,
    records: structuredClone(fixture.records.filter((record) => [owner.source_id_endpoint, owner.target_id, owner.document_revision_id, 'person:010'].includes(record.semantic_id))),
    edges: [{ ...owner, ownership_mode: 'exclusive' }, { ...owner, relationship_id: 'edge:exclusive-overlay', source_id_endpoint: 'person:010', ownership_mode: 'exclusive' }],
  };
  const doc = input.records.find((record) => record.type === 'Document')!;
  doc.content = `${String(doc.content)}\nAt ${owner.anchor}, fictional review asserts person:010 OWNS service:010 with current validity and reviewed review state.`;
  doc.content_digest = createHash('sha256').update(String(doc.content)).digest('hex');
  const exclusive = assembleEvidence(input);
  assert.equal(exclusive.status, 'conflict');
  assert.ok(exclusive.gaps.some((gap) => gap.code === 'ownership_conflict'));
  assert.equal(exclusive.facts.filter((fact) => fact.predicate === 'OWNS').length, 0);
  const conflictDoc: SemanticRecord = { ...originalDoc, semantic_id: 'document:overlay-conflict', content: 'Conflicting synthetic revision content.' };
  conflictDoc.content_digest = createHash('sha256').update(String(conflictDoc.content)).digest('hex');
  const conflict = assembleEvidence({ requestId: 'revision-conflict', targetId: 'service:010', intent: 'owners', records: [...fixture.records, conflictDoc], edges: [owner] });
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.gaps.some((gap) => gap.code === 'source_revision_conflict'));
  assert.equal(conflict.facts.filter((fact) => fact.predicate === 'OWNS').length, 0);
});

test('source applicability 3/3: historical immutable proof accepted, stale/unknown reject positive facts', () => {
  const edge = fixture.edges.find((item) => item.relationship_id === 'edge:0307')!;
  const base = {
    requestId: 'applicability', targetId: 'service:010', intent: 'owners' as const,
    records: structuredClone(fixture.records.filter((record) => [edge.source_id_endpoint, edge.target_id, edge.document_revision_id].includes(record.semantic_id))),
    edges: [edge],
  };
  for (const applicability of ['historical', 'stale', 'unknown']) {
    const input = structuredClone(base);
    input.records.find((record) => record.type === 'Document')!.applicability_state = applicability;
    const report = assembleEvidence(input);
    if (applicability === 'historical') assert.equal(report.facts.filter((fact) => fact.predicate === 'OWNS').length, 1);
    else {
      assert.equal(report.status, 'incomplete');
      assert.equal(report.facts.filter((fact) => fact.predicate === 'OWNS').length, 0);
      assert.ok(report.gaps.length >= 1);
    }
  }
});
