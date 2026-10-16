# Evaluation status

Evidence recorded on 2026-10-16: T01, T02, T03, and T06 passed. T04, T05, and T07 remain not assessed; T08 and the complete E01–E26 acceptance matrix remain not assessed. Partial case-level tests do not count as the complete T08 evaluation.

## T06 performance procedure

The frozen query input set is [`tests/evaluation/queries.json`](../tests/evaluation/queries.json), revision `t06-graphstore-inspect-v1`. It contains 20 unique `GraphStore.inspect` input tuples. Each tuple gets one warmup and exactly five measured repetitions, for 100 required measured samples. The latency gate is nearest-rank p95, the 95th sorted sample of all 100 measured attempts, strictly below 1,000 ms. Any timeout or incomplete attempt remains in the evidence and fails the gate.

Timing covers the `GraphStore.inspect` call: FalkorDB requests, returned data transfer, and local evidence projection. No model/provider call occurs. Each attempt, including errors and client or server timeouts, is retained in the latency CSV. The runner records `EvidenceReport.status` separately; an incomplete report is not silently counted as complete.

Before saving any graph data, the runner compares a normalized local snapshot against the generated synthetic fixture. A mismatch blocks the run without writing graph properties to disk. For a match, it copies the graph snapshot, generated fixture, oracle ledger, and query catalog into a unique run folder under `work/evaluation/runs/`. It records byte length and SHA-256 for each copy, then verifies copied hashes before measurement. It checks exact physical counts of 1,000 nodes and 3,000 edges both before and after the read-only run, and compares snapshot hashes. Environment metadata includes raw server version and FalkorDB module name/version codes from Redis `INFO`, plus the pinned container image reference/digest and compose-file hash. Physical counts and matching hashes do not establish correct source lineage topology. Volume persistence and exclusive-writer protection remain explicitly unverified by this runner.

The source oracle ledger states that no independent human reviewer is recorded. It is frozen as an input for traceability only; this benchmark does not score expected answers, source entailment, or semantic correctness.

From `outputs/entry`, root can invoke the benchmark with:

```sh
npm exec -- tsx tests/evaluation/performance.ts
```

The command connects only to the configured local FalkorDB endpoint. Outputs go under ignored `work/evaluation/runs/<run-id>/`. It exits nonzero unless the full T06 gate passes.

The recorded run [`20261016T181010252Z-f6d899ab`](../work/evaluation/runs/20261016T181010252Z-f6d899ab/summary.json) passed: 20 queries, 100/100 measured attempts, nearest-rank p95 40.439 ms (<1,000 ms), zero errors/timeouts/incomplete reports, generated fixture matched, exact 1,000-node/3,000-edge counts before and after, and unchanged graph snapshot. This establishes the T06 performance gate only; it does not establish lineage topology or other acceptance criteria.

## Acceptance ledger

Passing code tests or counting graph records does not establish unrun acceptance criteria. T01–T03 below were checked against the frozen oracle using the named real-FalkorDB tests. T06 was checked by the measured run above. T04, T05, T07, T08, and the full case matrix remain open.

| Criterion | Denominator | Status |
|---|---:|---|
| T01 dependency and owner recall | 20 | Passed: 20/20, `tests/graph/retrieval.test.ts` (real FalkorDB) |
| T02 superseded-decision handling | 10 | Passed: 10/10, `tests/graph/lineage.test.ts` (real FalkorDB) |
| T03 claim-level evidence integrity | 10 | Passed: 10/10, `tests/evidence/claims.test.ts` (real FalkorDB) |
| T04 persistence, restart, and interrupted-save reconciliation | 2 restart cycles + 1 interrupted-save workflow | Not assessed |
| T05 database outage behavior | 5 workflows | Not assessed |
| T06 bounded performance | 20 queries, 100 measured attempts | Passed: 100/100; p95 40.439 ms; see run evidence above |
| T07 participant understanding | 4 explanations | Not assessed |
| T08 adversarial catalog | 26 cases | Not assessed |

| Case | Status | Case | Status |
|---|---|---|---|
| E01 missing owner | Not assessed | E14 direct target with no consumers | Not assessed |
| E02 contradictory ownership | Not assessed | E15 predecessor changes after review | Not assessed |
| E03 stale ownership evidence | Not assessed | E16 lost acknowledgment and duplicate retry | Not assessed |
| E04 missing current source revision | Not assessed | E17 disconnected cycle in scope | Not assessed |
| E05 conflicting current revisions | Not assessed | E18 altered intent under same request ID | Not assessed |
| E06 citation does not entail owner claim | Not assessed | E19 inventory changes without source revision change | Not assessed |
| E07 valid dependency cycle | Not assessed | E20 cross-scope supersession or ABOUT mismatch | Not assessed |
| E08 accepted decision cycle | Not assessed | E21 Cypher-like input text | Not assessed |
| E09 multiple accepted successors | Not assessed | E22 duplicate immutable revision identity | Not assessed |
| E10 truncated lineage inventory | Not assessed | E23 citation without immutable revision identity | Not assessed |
| E11 path overflow | Not assessed | E24 dangling evidence reference | Not assessed |
| E12 database timeout or outage | Not assessed | E25 empty graph | Not assessed |
| E13 merged decision predecessors | Not assessed | E26 relevant neighbor beyond depth bound | Not assessed |
