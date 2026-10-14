# G01 real FalkorDB client spike

Test plan written after the event window opened on October 14, 2026. Results below come from real client/server runs.

1. `shape_stable_ids`: real official 6.8.0 client returns 2 nodes and 1 edge, 3/3 stable property IDs and exact endpoint identities survive reconnect and 2 server restarts.
2. `parameter_literal`: malicious-looking quoted parameter round-trips byte-for-byte, 1/1, with 0 injected nodes.
3. `read_timeout`: real expensive query with TIMEOUT 2,000 ms fails explicitly within 3,000 ms, 1/1; no successful partial result.
4. `accepted_commit_complete`: one query commits exactly 1 accepted Decision, 1 ABOUT, 1 CITES and durable request/intent bindings, 4/4 persisted objects/bindings.
5. `receipt_first_retry`: 2 identical attempts resolve identical decision ID with 0 additional nodes/edges; repeat after scope advances and retain original ID.
6. `changed_intent_conflict`: same request ID with altered canonical intent rejects, 1/1, with 0 mutations.
7. `stale_new_request`: mismatched expected predecessor rejects, 1/1, with 0 mutations.
8. `runtime_failure_rollback`: force query runtime failure after a CREATE, 1/1, with 0 partial nodes/edges.
9. `interrupted_write`: interrupt one in-flight write and restart same persistent volume; state is exactly absent or complete, 1/1, with 0 partial states. Complete receipt returns original ID without new writes. Absent receipt requires fresh review in application implementation, not fabricated approval here.

Supplemental numeric checks: refused connection yields explicit unavailable in <3,000 ms; worker refusal then successful real read returns 2/2 correct statuses; lost-ack 2/2 retries return same ID with 0 writes; actual dependency addition/property change/deletion and owner addition reject 4/4 new saves with 0 writes, unchanged Document revision; already committed receipt ignores obsolete inventory with 0 writes.

Implementation plan: inspect installed actual exports, start official pinned 6.0.0 image with AOF always on isolated volume, implement one native Node reference runner against real graph, run checks and record actual failures before promoting any pattern.

Non-goals: application implementation, production concurrency, participant approval/UI/nonce simulation, private inputs, provider calls, public publication. Exclusive application-writer boundary remains separate integration proof. Multi-command Redis transactions are not accepted as rollback evidence.

Context7: cached MCP 1.0.31, actual `resolve-library-id` then equivalent legacy `get-library-docs`; official `/falkordb/falkordb-ts` and `/falkordb/docs` retrieved. APIs: `FalkorDB.connect`, `selectGraph`, `query(query,{params,TIMEOUT})`, object-row `data`, node `properties`, relationship endpoints. Documentation atomicity claims require real checks above.

## Actual results

`node spike.mjs` passed 15/15 named checks, real client/server, no database mocks. [results.json](results.json) records actual timestamp and per-check observations. Runner fails closed unless Docker inspection proves the pinned G01 container, loopback port binding and exact data volume; it compares Redis run ID through the SDK connection before deleting the fixture graph. Runtime module version and architecture are captured from the connected server. Timeout 2,000 ms rejected in 2,001 ms on the independent rerun. Runtime error after Decision/ABOUT/CITES creation left 0 nodes/edges. Lost acknowledgment was deliberately discarded only after actual confirmed commit; 2 retries returned original ID, 0 writes. Two server restarts retained exact IDs and links. SIGKILL 150 ms into pending save yielded transport uncertainty; same-volume recovery showed absent receipt, 0 partial objects. Four material changes invalidated new saves without changing Document revision; committed receipt still resolved with 0 writes.

Pinned server: `falkordb/falkordb@sha256:92fbda814970a648b1fd80835bff221766bccd0f0ce958bc58a62976fea06620`, module version 60000, actual arm64 Docker server. Container `graph-hacks-g01-falkordb`; volume `graph-hacks-2026-g01-data`, mounted `/var/lib/falkordb/data`; only `127.0.0.1:6379` published, browser disabled. `appendonly=yes`, `appendfsync=always` confirmed from server CONFIG. All Docker commands explicitly use `--context colima`; global default remains unchanged.

Official client 6.8.0, Node 26.11.1, npm 11.20.0. Registry integrity `sha512-kPYTgo7LCQsZW6OO4o0k9hhwmitbZ+7xhLqtjMPV9h/rzLL3QqojBFpc1hv3xRhT2bZpJ4z0z/lH7rijID82Cg==`. Isolated exact lockfile install used `npm ci --ignore-scripts`. Actual npm audit: 0 vulnerabilities, including 0 high/critical. No entry-root manifests changed.

Actual object rows: `result.data` array; nodes `{id:number,labels:string[],properties:object}`; edges `{id:number,sourceId:number,destinationId:number,relationshipType:string,properties:object}`. Canonical IDs come from `properties.id`; numeric internal identities used only to validate endpoints within returned shape. Object-map parameter equality is property-order independent on actual server. Full stable edge ID/endpoints/type/properties inventory can be compared within the same write query.

## Failure preserved and promotion limits

First immediate reconnect after `docker restart` crashed runner with unhandled `SocketClosedUnexpectedlyError` before `FalkorDB.connect` returned its instance. Bounded Redis PING readiness (5,000 ms) repaired this isolated restart setup. Ordinary connection refusal is different: actual child process caught `ECONNREFUSED`, returned unavailable, exit 0. Native worker probe proved ordinary refusal followed by real read recovery; it did not prove containment of the separate factory socket-close crash. Production connection handling must address that race before claiming robust outage semantics.

This reference proves atomic query/receipt pattern on a small valid synthetic scope. It does not prove application participant approval, nonce, pending-review expiry, exclusive-writer access boundary, all per-intent material inventories, full accepted-chain validation, network/queue wall-clock deadlines or host/power-loss durability. Browser/HTTP/model tests remain separate. No T01–T08 acceptance claimed. Root must integrate and independently review these patterns before application promotion; no silent SPEC/PLAN changes.

SHORTCUT: graph fixture includes Service→Document USES solely for raw return-shape testing, not the application's canonical typed relation model. Readiness shell commands and native worker are isolated test helpers. `spike.mjs` resets only named `g01_falkordb_spike` graph and interrupts only named G01 container. Never point it at an application graph/container. Container/volume left available for root review, no unrelated resource pruned.
