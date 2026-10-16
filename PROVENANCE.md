# Provenance

All graph entities, relationships, names, claims, source excerpts, decision rationales and dates are fictional. `fixtures/generate.ts` creates the selected baseline with generator version `f01-v1` and seed `20261008`. The baseline target is 1,000 nodes and 3,000 relationships. `fixtures/scenarios.md` describes the intended questions; `fixtures/oracle-ledger.md` records expected IDs and paths independently of application answers.

Synthetic source excerpts state the exact directed edge and anchor used by each fixture. They are test evidence only. They do not describe real services or support real operational decisions.

The local UI bundles Geist Sans and Geist Mono font files from the `geist` package. Redistribution terms are included at [`public/fonts/LICENSE.txt`](public/fonts/LICENSE.txt).

No private source files or external business graph were ingested. The live local graph is a generated synthetic fixture. The separate review-integrity test uses a dedicated graph name and removes its fixture after the test.
