# FalkorDB 6.8.0 client reference

Status: observed against the official client and pinned local server on October 14, 2026. This is a small synthetic G01 proof, not application acceptance.

## Verified behavior

- Official `falkordb@6.8.0` returns object rows in `result.data`. Node IDs and relationship IDs are numeric internal IDs. Stable app IDs must be stored and read from `properties.id`; relationship results expose `sourceId`, `destinationId`, and `relationshipType`.
- Query values are passed through `{ params }`. A quote, backslash, Unicode character, and newline round-tripped exactly; no injected node appeared.
- `TIMEOUT: 2000` rejected a deliberately expensive read in 2,001 ms in the independently rerun spike.
- One write query that created a Decision and its ABOUT/CITES links, then raised a runtime error, left zero partial nodes or edges. This is evidence for one FalkorDB query's atomicity, not for a sequence of queries or multiple commands.
- One-query save followed by a receipt read preserved exact request binding and links. Matching retry returned the original ID with zero extra writes, including after the decision chain advanced. Altered intent and stale predecessor each rejected with zero writes.
- Add/change/delete of a dependency and addition of an owner each invalidated a new write in the tested small inventory while Document revision stayed unchanged. A prior committed receipt still resolved with zero writes. Full per-intent inventories and complete lineage validation remain application work.
- Two Docker restarts on the same named volume preserved graph IDs, exact edge endpoints, and receipts. The image had append-only persistence enabled with `appendfsync=always`. A SIGKILL during a pending write returned transport uncertainty; after same-volume recovery, the request was absent with zero partial objects. The application must treat uncertainty as unknown and renew review if absent.
- Ordinary connection refusal surfaced `ECONNREFUSED`, which the awaited factory call caught. A native worker probe recovered from refusal and completed a real read. This does not prove containment of the separately observed `SocketClosedUnexpectedlyError` race during immediate reconnect after restart.

## Runtime pinned by the proof

- Client `falkordb@6.8.0`; Node 26.11.1; npm 11.20.0.
- Server image `falkordb/falkordb@sha256:92fbda814970a648b1fd80835bff221766bccd0f0ce958bc58a62976fea06620`, graph module version 60000, observed `aarch64`.
- Docker container `graph-hacks-g01-falkordb`; volume `graph-hacks-2026-g01-data`; host port bound only to `127.0.0.1:6379`; graph `g01_falkordb_spike`.
- Runner verifies container image, loopback mapping, exact volume and connected-server run ID before resetting the fixture graph. Runtime module version and architecture are read through the SDK connection.
- `npm audit --omit=dev` reported 0 vulnerabilities.

Full code and per-check observations: [spike runner](../spikes/reference/falkordb-client/spike.mjs), [results](../spikes/reference/falkordb-client/results.json), [runner notes](../spikes/reference/falkordb-client/README.md).

## Application requirements still gated

- Production readiness/health must contain initial and reconnect failures, expose graph outage explicitly, and recover without fabricated success. Specifically test `SocketClosedUnexpectedlyError` around restart; basic refusal recovery alone is insufficient.
- Keep all reviewed decision, required links, stable IDs, request ID, and canonical binding in one parameterized graph write query. On query error, acknowledge nothing. Resolve a durable exact-match receipt before stale/current-material checks. Read outage remains uncertain.
- Application tests must prove approval/nonce/restart expiry, exclusive-writer boundary, complete accepted-chain validation, all per-intent material inventories, and absent/complete interrupted-save branches. These were not proven by G01.
- Host/power-loss durability, network/queue wall-clock deadlines, participant workflow, HTTP boundary, model behavior, T01–T08, and performance remain untested.
