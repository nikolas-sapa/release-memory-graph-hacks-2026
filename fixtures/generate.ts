import { createHash } from 'node:crypto';

export const SEED = 20261008;
export const GENERATOR_VERSION = 'f01-v1';

export type NodeType = 'Person' | 'Project' | 'Service' | 'Ticket' | 'Document' | 'Decision';
export type RelationType = 'OWNS' | 'USES' | 'DEPENDS_ON' | 'AFFECTS' | 'ABOUT' | 'CITES' | 'SUPERSEDES' | 'REVISES';
export interface SemanticRecord {
  semantic_id: string;
  type: NodeType;
  name: string;
  [key: string]: unknown;
}
export interface FactEdge {
  relationship_id: string;
  type: RelationType;
  source_id_endpoint: string;
  target_id: string;
  source_id: string;
  document_revision_id: string;
  anchor: string;
  asserted_at: string;
  validity_state: 'current' | 'stale' | 'unknown';
  review_state: 'reviewed' | 'unreviewed' | 'disputed';
  acceptance_state?: 'accepted';
  reviewer_id?: string;
  reviewed_at?: string;
}
export interface Fixture { seed: number; generator_version: string; records: SemanticRecord[]; edges: FactEdge[]; canonical_json: string; sha256: string }

const counts: Record<NodeType, number> = { Person: 120, Project: 100, Service: 280, Ticket: 180, Document: 220, Decision: 100 };
const typePrefix: Record<NodeType, string> = { Person: 'person', Project: 'project', Service: 'service', Ticket: 'ticket', Document: 'document', Decision: 'decision' };
const names: Record<NodeType, string[]> = {
  Person: ['Avery Example', 'Jordan Sample', 'Morgan Fiction', 'Riley Demo', 'Casey Synthetic'],
  Project: ['Harbor Release', 'Northstar Migration', 'Bluebird Preview', 'Sandbox Launch'],
  Service: ['Northstar Demo Service', 'Harbor Queue', 'Bluebird Catalog', 'Fictional Relay'],
  Ticket: ['Release readiness review', 'Synthetic dependency check', 'Demo rollback rehearsal'],
  Document: ['Fictional release note', 'Synthetic service review', 'Demo operations guide'],
  Decision: ['Retain Northstar Demo Service', 'Review release dependency', 'Approve staged migration'],
};
const stamp = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
const id = (type: NodeType, n: number) => `${typePrefix[type]}:${String(n).padStart(3, '0')}`;
const at = <T>(values: T[], index: number): T => { const value = values[index]; if (value === undefined) throw new Error(`fixture index ${index} out of range`); return value; };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeRecords(): SemanticRecord[] {
  const records: SemanticRecord[] = [];
  for (const type of Object.keys(counts) as NodeType[]) for (let n = 1; n <= counts[type]; n++) {
    const record: SemanticRecord = { semantic_id: id(type, n), type, name: type === 'Service' && n === 30 ? `Renamed Fictional Relay ${String(n).padStart(3, '0')}` : type === 'Service' && n === 18 ? `Northstar Demo Service ${String(n).padStart(3, '0')}` : `${names[type][(n - 1) % names[type].length]} ${String(n).padStart(3, '0')}`, record_state: 'active' };
    if (type === 'Service' && n === 30) record.previous_synthetic_name = `Northstar Demo Service ${String(n).padStart(3, '0')}`;
    if (type === 'Person') { record.role = n % 3 === 0 ? 'service owner' : 'release reviewer'; if (n <= 40) record.team_id = `team:${String(((n - 1) % 8) + 1).padStart(3, '0')}`; }
    if (type === 'Project') record.purpose = `Fictional staged-release workstream ${n}`;
    if (type === 'Service') { record.purpose = `Synthetic service used by fictional release ${n}`; record.lifecycle_state = n % 17 === 0 ? 'retired' : 'active'; }
    if (type === 'Ticket') Object.assign(record, { key: `DEMO-${String(n).padStart(3, '0')}`, status: n % 4 ? 'reviewed' : 'open', created_at: stamp(1 + n % 20), reviewed_at: n % 4 ? stamp(2 + n % 20) : null });
    if (type === 'Document') Object.assign(record, { title: record.name, source_id: `source:${String(Math.ceil(n / 3)).padStart(3, '0')}`, revision_identity: `r${((n - 1) % 3) + 1}`, content: `Fictional synthetic example. ${names['Document'][(n - 1) % names['Document'].length]} records a staged-release review for example entities only.`, content_digest: createHash('sha256').update(`fictional-document-${n}`).digest('hex'), origin: 'synthetic', created_at: stamp(1 + n % 20), applicability_state: n % 11 === 0 ? 'stale' : 'current' });
    if (type === 'Decision') Object.assign(record, { decision_key: `release-retention-${Math.ceil(n / 3)}`, state: 'accepted', rationale: 'Fictional review retains the dependency until the documented migration constraint is resolved.', reviewed_at: stamp(1 + n % 20), accepted_at: stamp(1 + n % 20) });
    records.push(record);
  }
  // Document lineages: sixty length-three and twenty length-two chains (220 revisions, 140 links).
  let doc = 1;
  for (let lineage = 1; lineage <= 80; lineage++) {
    const length = lineage <= 60 ? 3 : 2;
    for (let revision = 1; revision <= length; revision++, doc++) {
      const record = records.find((r) => r.semantic_id === id('Document', doc))!;
      record.source_id = `source:${String(lineage).padStart(3, '0')}`;
      record.revision_identity = `r${revision}`;
      if (revision > 1) record.predecessor_id = id('Document', doc - 1);
      record.applicability_state = revision === length ? 'current' : 'historical';
    }
  }
  return records.sort((a, b) => a.semantic_id.localeCompare(b.semantic_id));
}

export function generateFixture(seed = SEED): Fixture {
  const records = makeRecords();
  const byType = (type: NodeType) => records.filter((r) => r.type === type);
  const edges: Omit<FactEdge, 'source_id' | 'document_revision_id' | 'anchor' | 'asserted_at' | 'validity_state' | 'review_state'>[] = [];
  const add = (type: RelationType, from: string, to: string, chain?: number) => edges.push({ relationship_id: `edge:${String(edges.length + 1).padStart(4, '0')}`, type, source_id_endpoint: from, target_id: to, ...(chain === undefined ? {} : { _chain: chain }) } as typeof edges[number] & { _chain?: number });
  const people = byType('Person'), projects = byType('Project'), services = byType('Service'), tickets = byType('Ticket'), docs = byType('Document'), decisions = byType('Decision');

  // Dense, deterministic story subgraph: Q01-Q20 scenarios use stable entities in first 20 services.
  const topology: Array<[number, number]> = [[2,1],[3,2],[4,3],[5,2],[5,3],[3,1],[6,1],[11,10],[13,12],[16,15],[19,18],[22,21],[24,22],[26,25],[25,26],[29,28],[28,27],[27,26],[31,30],[32,31],[33,32],[35,34],[36,35],[37,36],[38,37],[39,38],[40,39],[41,40],[42,41],[43,42],[44,43],[45,44],[46,45],[47,46],[48,47],[49,48],[50,49],[52,51]];
  for (const [consumer, provider] of topology) add('DEPENDS_ON', id('Service', consumer), id('Service', provider));
  // 40 disjoint accepted chains: twenty triples and twenty pairs, total 100 decisions / 60 links.
  let d = 1;
  for (let chain = 1; chain <= 40; chain++) {
    const length = chain <= 20 ? 3 : 2;
    const subject = id('Service', chain);
    for (let pos = 0; pos < length; pos++, d++) {
      const decision = at(decisions, d - 1); decision.scope_subject_id = subject; decision.decision_key = `scope-${String(chain).padStart(3, '0')}`;
      decision.rationale = pos === length - 1 ? 'Fictional staged-release review records that the migration constraint is resolved, so replacement is approved.' : 'Fictional staged-release review retains the dependency while the migration constraint remains unresolved.';
      if (pos > 0) { decision.expected_predecessor_id = at(decisions, d - 2).semantic_id; add('SUPERSEDES', decision.semantic_id, at(decisions, d - 2).semantic_id, chain); }
      add('ABOUT', decision.semantic_id, subject, chain);
      add('CITES', decision.semantic_id, at(docs, (d * 2 + pos) % docs.length).semantic_id, chain);
    }
  }
  // A curated scenario spine plus deterministic fill gives all required relation totals.
  const curatedOwners: Array<[number, number]> = [[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,13],[12,14],[13,14],[15,17],[16,18],[17,19],[18,20],[19,21],[20,22],[21,23],[22,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32],[31,33],[32,34],[33,35],[34,36],[35,37],[36,38],[37,39],[38,40],[39,41],[40,42],[41,43]];
  for (const [person, service] of curatedOwners) add('OWNS', id('Person', person), id('Service', service));
  for (let i = 1; i <= 100; i++) add('OWNS', id('Person', i <= 2 ? 40 : (i + 39) % 120 + 1), at(projects, i - 1).semantic_id);
  for (let i = 41; i <= 320; i++) add('OWNS', at(people, (i * 7) % 120).semantic_id, id('Service', 50 + (i % 230)));
  for (let i = 1; i <= 20; i++) add('USES', id('Project', i), id('Service', i === 3 || i === 4 ? 13 : i));
  for (let i = 21; i <= 1000; i++) add('USES', id('Project', 30 + ((i - 21) % 71)), id('Service', 50 + ((i * 13) % 230)));
  for (let i = topology.length + 1; i <= 700; i++) add('DEPENDS_ON', id('Service', 50 + ((i * 17) % 230)), id('Service', 50 + ((i * 29 + 1) % 230)));
  for (let i = 1; i <= 220; i++) add('AFFECTS', at(tickets, i % 180).semantic_id, at(i % 2 ? projects : services, i % 2 ? i % 100 : i % 280).semantic_id);
  // ABOUT/CITES/SUPERSEDES counts already include lineage spine.
  while (edges.filter((e) => e.type === 'ABOUT').length < 100) { const i = edges.filter((e) => e.type === 'ABOUT').length; add('ABOUT', at(decisions, i).semantic_id, at(services, (i + 99) % 280).semantic_id); }
  while (edges.filter((e) => e.type === 'CITES').length < 360) { const i = edges.filter((e) => e.type === 'CITES').length; add('CITES', at(decisions, i % 100).semantic_id, at(docs, (i * 7) % 220).semantic_id); }
  // 60 supersedes links were made with chain edges above.
  let docIndex = 0;
  for (let lineage = 1; lineage <= 80; lineage++) { const length = lineage <= 60 ? 3 : 2; for (let pos = 1; pos < length; pos++) { docIndex++; add('REVISES', id('Document', docIndex + 1), id('Document', docIndex)); } docIndex++; }
  const random = seeded(seed);
  const fullEdges: FactEdge[] = edges.map((edge, index) => {
    const sourceDoc = at(docs, (index * 37 + Math.floor(random() * docs.length)) % docs.length);
    const chain = (edge as typeof edge & { _chain?: number })._chain;
    const currentScenarioEdge = (edge.type === 'DEPENDS_ON' && Number(edge.source_id_endpoint.slice(8)) <= 52 && Number(edge.target_id.slice(8)) <= 52)
      || (edge.type === 'OWNS' && ((edge.target_id.startsWith('service:') && Number(edge.target_id.slice(8)) <= 49) || (edge.target_id.startsWith('project:') && Number(edge.target_id.slice(8)) <= 20)))
      || (edge.type === 'USES' && Number(edge.source_id_endpoint.slice(8)) <= 20)
      || (['ABOUT', 'CITES', 'SUPERSEDES'].includes(edge.type) && Number(edge.source_id_endpoint.slice(9)) <= 30);
    const result = { ...edge, source_id: String(sourceDoc.source_id), document_revision_id: sourceDoc.semantic_id, anchor: `section-${String((index % 12) + 1).padStart(2, '0')}/paragraph-${String((index % 7) + 1).padStart(2, '0')}`, asserted_at: stamp(1 + (index % 20)), validity_state: currentScenarioEdge || index % 19 !== 0 ? 'current' as const : 'stale' as const, review_state: 'reviewed' as const } as FactEdge;
    delete (result as FactEdge & { _chain?: number })._chain;
    if (edge.type === 'SUPERSEDES') { result.acceptance_state = 'accepted'; result.reviewer_id = at(people, index % 20).semantic_id; result.reviewed_at = stamp(1 + index % 20); }
    return result;
  }).sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  // Synthetic source excerpts explicitly assert each generated relationship at its stable anchor.
  for (const edge of fullEdges) {
    const doc = records.find((record) => record.semantic_id === edge.document_revision_id)!;
    const assertion = `At ${edge.anchor}, fictional review asserts ${edge.source_id_endpoint} ${edge.type} ${edge.target_id} with ${edge.validity_state} validity and ${edge.review_state} review state.`;
    const decision = edge.type === 'CITES' ? records.find((record) => record.semantic_id === edge.source_id_endpoint) : undefined;
    doc.content = `${String(doc.content)}\n${assertion}`;
    if (decision) {
      const citedDocument = records.find((record) => record.semantic_id === edge.target_id)!;
      citedDocument.content = `${String(citedDocument.content)}\nSynthetic rationale anchor ${edge.anchor}: ${String(decision.rationale)}`;
    }
  }
  for (const doc of docs) doc.content_digest = createHash('sha256').update(String(doc.content)).digest('hex');
  const canonical_json = JSON.stringify({ seed, generator_version: GENERATOR_VERSION, records, edges: fullEdges });
  return { seed, generator_version: GENERATOR_VERSION, records, edges: fullEdges, canonical_json, sha256: createHash('sha256').update(canonical_json).digest('hex') };
}
