# Hackathon submission draft

## Track

Company Brain.

## Project

Release Memory is a local graph review tool for release decisions. It traces service impact and ownership through typed FalkorDB edges, retrieves source-bound evidence, and shows how accepted decisions changed over time. A person reviews and confirms every proposed decision update.

## What is ready

- Local TypeScript app and accessible evidence UI.
- Synthetic graph fixture targeting 1,000 nodes and 3,000 edges.
- Bounded graph retrieval, source lookup, explicit review and confirmation flow.
- Local HTTP boundary with same-origin checks, fresh nonce, streamed body cap, strict content policy and fixed static assets.
- Unit, boundary, rendering and real FalkorDB integration tests.

## What remains unverified

- Live model/provider access and quality. No credential or provider request used.
- Full T01–T08 and E01–E26 acceptance report.
- Two application/database restart cycles and interrupted-save reconciliation against the persistent volume.
- Participant's four-query explanation assessment.
- Recorded three-minute demo video.

This file is a preparation draft. It is not a registration, public release or submitted entry.
