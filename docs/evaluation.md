# Evaluation status

Latest acceptance run: 2026-10-18. Typecheck and build pass; automated suite passes 103/103, real-FalkorDB integration passes 3/3, and T05 real-database outage checks pass 5/5. The complete test logs, item ledger, frozen inputs, and environment are under [`20261018T110654Z-acceptance-v1`](../work/evaluation/runs/20261018T110654Z-acceptance-v1/).

Formal status remains qualified. T01 and T02 machine comparisons passed 20/20 and 10/10, but their frozen oracle has no independent human reviewer recorded. T03 machine evidence checks passed 10/10, but required human entailment review is absent. T04 is blocked because the current Docker context exposes no verified persistent volume. T07 is not assessed because no participant answers were collected. T08 code assertions pass 26/26, but the target remains not assessed pending independent review of expected outcomes. The protected graph and its original volume were not mounted or modified.

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

The recorded run [`20261016T181010252Z-f6d899ab`](../work/evaluation/runs/20261016T181010252Z-f6d899ab/summary.json) passed with p95 40.439 ms. The 2026-10-18 run [`20261018T110355278Z-80d6f34e`](../work/evaluation/runs/20261018T110355278Z-80d6f34e/summary.json) returned 100 complete samples and unchanged counts/snapshot, but failed latency at p95 1,346.053 ms. Two controlled repeats on a fresh, unmounted graph then passed: [`20261018T155516834Z-dd87a8f5`](../work/evaluation/runs/20261018T155516834Z-dd87a8f5/summary.json) at p95 91.339 ms and [`20261018T155536088Z-ecb8afab`](../work/evaluation/runs/20261018T155536088Z-ecb8afab/summary.json) at p95 152.441 ms. Both had 100/100 complete attempts, zero errors/timeouts, matching 1,000-node/3,000-edge fixture counts, and unchanged graph snapshots. The Colima VM stayed at 2 CPUs/2 GiB; diagnostics recorded Redis graph-query time and container resource/network activity. The original slowdown's cause remains unproven. Latest T06 status: passed; retain the failed run as regression evidence.

## Acceptance ledger

Passing code tests or counting graph records does not establish unrun acceptance criteria. The 2026-10-18 item ledger distinguishes machine-checked outcomes from human and persistence requirements. The T08 frozen input manifest is [`manifest.json`](../work/evaluation/runs/20261018T110654Z-acceptance-v1/frozen/manifest.json); its independent human review field is explicitly “not recorded.”

| Criterion | Denominator | Status |
|---|---:|---|
| T01 dependency and owner recall | 20 | Not assessed: machine comparison 20/20; independent oracle review not recorded |
| T02 superseded-decision handling | 10 | Not assessed: machine comparison 10/10; independent oracle review not recorded |
| T03 claim-level evidence integrity | 10 | Not assessed: machine evidence checks 10/10; human entailment review not recorded |
| T04 persistence, restart, and interrupted-save reconciliation | 2 restart cycles + 1 interrupted-save workflow | Blocked: verified persistent volume unavailable in current Docker context; see restart record |
| T05 database outage behavior | 5 workflows | Passed: real disposable database stop/restart; 5/5 explicit failures, zero provider calls or decisions |
| T06 bounded performance | 20 queries, 100 measured attempts | Passed on latest two controlled runs: p95 91.339 ms and 152.441 ms; earlier 1,346.053 ms failure retained |
| T07 participant understanding | 4 explanations | Not assessed: no participant record |
| T08 adversarial catalog | 26 cases | Not assessed overall: 26/26 code assertions passed; independent oracle review not recorded |

| Case | Status | Case | Status |
|---|---|---|---|
| E01 missing owner | Code test passed | E14 direct target with no consumers | Code test passed |
| E02 contradictory ownership | Code test passed | E15 predecessor changes after review | Code test passed |
| E03 stale ownership evidence | Code test passed | E16 lost acknowledgment and duplicate retry | Code test passed |
| E04 missing current source revision | Code test passed | E17 disconnected cycle in scope | Code test passed |
| E05 conflicting current revisions | Code test passed | E18 altered intent under same request ID | Code test passed |
| E06 citation does not entail owner claim | Code test passed | E19 inventory changes without source revision change | Code test passed |
| E07 valid dependency cycle | Code test passed | E20 cross-scope supersession or ABOUT mismatch | Code test passed |
| E08 accepted decision cycle | Code test passed | E21 Cypher-like input text | Code test passed |
| E09 multiple accepted successors | Code test passed | E22 duplicate immutable revision identity | Code test passed |
| E10 truncated lineage inventory | Code test passed | E23 citation without immutable revision identity | Code test passed |
| E11 path overflow | Code test passed | E24 dangling evidence reference | Code test passed |
| E12 database timeout or outage | Code test passed | E25 empty graph | Code test passed |
| E13 merged decision predecessors | Code test passed | E26 relevant neighbor beyond depth bound | Code test passed |
