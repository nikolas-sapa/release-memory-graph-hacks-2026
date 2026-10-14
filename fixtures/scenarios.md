# F01 synthetic scenario manifest

Generator `f01-v1`, seed `20261008`. Every entity, claim, title, key, and timestamp is synthetic. Dates are story values, never commit-time evidence. The baseline contains only valid topology. Corrupt E01–E26 fixtures remain separate overlays and are not generated here.

The generator writes each fact edge's exact endpoint/type assertion into the cited immutable synthetic document revision at the edge's anchor, then hashes that revision content. Thus edge provenance references a source excerpt that asserts the exact directed fact. Decision citation excerpts also preserve the decision rationale verbatim. No scenario text below comes from application output.

## Q01–Q20 graph sketches

Canonical short forms: `Snnn` = `service:nnn`; `Pnnn` = `project:nnn`; `Person:nnn` unchanged. Dependency direction is consumer → provider. Relationship IDs, exact source revision IDs, and anchors appear in `oracle-ledger.md`.

| ID | Seed and expected result |
|---|---|
| Q01 | Impact from S010: direct consumer S011, owner of target and consumer. |
| Q02 | Impact from S021: S022 → S021 and S024 → S022; all three services and direct owners. |
| Q03 | Impact from S030: consumer chain S033 → S032 → S031 → S030; terminal at 3 hops. |
| Q04 | Impact from S001 includes a diamond from S005 via S002 and S003, preserving both routes and the additional S005 → S003 → S002 route; S004 also reaches through S003 and S006 is a direct consumer. |
| Q05 | Impact from S001 returns direct consumers S002, S003, S006, plus S004/S005 downstream paths; S003 also has a route through S002. |
| Q06 | Impact from S007 has no service consumer; P007 directly uses S007; include service and project owners. |
| Q07 | Owners for S008 include its direct owner; P008 uses it, with P008 owner included in impact. |
| Q08 | Owners for S009 return direct owner; do not infer transitive owners. |
| Q09 | Impact from S010 returns S011 and owner paths for both; P010 directly uses S010. |
| Q10 | Impact from S012 returns S013; P003, P004, and P013 use S013, each with owner. |
| Q11 | S014 has exactly two documented direct owners, both retained. |
| Q12 | Impact from S015 includes S016; S016 has no OWNS edge, so owner is unknown. |
| Q13 | Select S017 by canonical ID when comparing its similar display label S018. |
| Q14 | Impact from S018 includes S019; disconnected S020 excluded. |
| Q15 | Impact from S001 includes P001/P002 and P005/P006 use paths; person:040 owns P001/P002 and is deduplicated while all paths remain. |
| Q16 | Prerequisites from S022 follow outgoing S022 → S021, with direct service owners. |
| Q17 | Impact from S022 follows incoming S024 → S022, distinct from Q16. |
| Q18 | Full incoming impact from S025 includes valid cycle S025↔S026 and consumer chain S029→S028→S027→S026; returns services S026–S029 and reports cycle. |
| Q19 | Impact from S030 reaches S031, S032, S033 exactly three hops; no relevant unexpanded consumer beyond S033. |
| Q20 | S030 has previous synthetic display name “Northstar Demo Service 030” and current name “Renamed Fictional Relay 030”; stable ID and dependency path remain. |

## L01–L10 replacement sketches

Forty disjoint accepted scopes comprise twenty 3-decision chains and twenty 2-decision chains. Scope `scope-NNN` maps to subject `service:NNN`. Each decision remains accepted; only derived labels change across the chain. Link direction is newer decision → predecessor. Source excerpts for each CITES edge contain the exact decision rationale. Relationship IDs, cited revision IDs, and anchors appear in `oracle-ledger.md`.

| ID | Scope and expected result |
|---|---|
| L01 | `service:001 / scope-001`: decision:001 → decision:002 → decision:003; prior 001, current 003. |
| L02 | `service:002 / scope-002`: decision:004 → decision:005 → decision:006; prior 004, current 006. |
| L03 | `service:003 / scope-003`: decision:007 → decision:008 → decision:009; requested prior/replacing pair 007/009. |
| L04 | `service:004 / scope-004`: decision:010 → 011 → 012; other keys excluded. |
| L05 | `service:005 / scope-005`: decision:013 → 014 → 015; same-key scopes on other subjects excluded. |
| L06 | `service:006 / scope-006`: decision:016 → 017 → 018; stable IDs distinguish similar titles. |
| L07 | `service:007 / scope-007`: decision:019 → 020 → 021; graph succession establishes head despite timestamp ties. |
| L08 | `service:008 / scope-008`: decision:022 → 023 → 024; subject ID persists through rename. |
| L09 | `service:009 / scope-009`: decision:025 → 026 → 027; prior source revision and replacing rationale both retained. |
| L10 | `service:010 / scope-010`: decision:028 → 029 → 030; stable replacing ID is retrievable in a later session. |

