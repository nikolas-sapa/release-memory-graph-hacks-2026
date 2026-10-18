# Hackathon submission draft

## Track

Company Brain.

## Project

Release Memory is a local graph review tool for release decisions. It traces service impact and ownership through typed FalkorDB edges, retrieves source-bound evidence, and shows how accepted decisions changed over time. A person reviews and confirms every proposed decision update.

## What is ready

- Local TypeScript app and accessible evidence UI.
- Synthetic graph fixture targeting 1,000 nodes and 3,000 edges.
- Bounded graph retrieval, source lookup, explicit review and confirmation flow.
- Deterministic loopback demo provider for a transparent, no-credential walkthrough.
- Local HTTP boundary with same-origin checks, fresh nonce, streamed body cap, strict content policy and fixed static assets.
- Unit, boundary, rendering and real FalkorDB integration tests.

## What remains unverified

- Live model/provider access and quality. No credential or provider request used.
- Full T01–T08 and E01–E26 acceptance report.
- Two application/database restart cycles and interrupted-save reconciliation against the persistent volume.
- Participant's four-query explanation assessment.
- Recorded YouTube demo video required by the event form.

## Submission status

Graph Hacks registration is confirmed. The public repository is https://github.com/nikolas-sapa/release-memory-graph-hacks-2026. The WeMakeDevs submission draft is filled except for the required YouTube video link. Do not treat the entry as submitted until the portal confirms it.

The demo uses synthetic data and a deterministic local stub. It demonstrates the graph evidence and review flow, not external model quality or production deployment.
