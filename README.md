# Release Memory

Local graph review for release-impact questions. Select a synthetic service, inspect its typed dependencies, owners, source revisions and accepted decision history, then prepare a cited review for explicit confirmation.

The graph remains the source of facts. The server chooses query bounds and evidence. Model output cannot add graph facts or approve a decision. Accepted reviews save only after a person confirms the exact reviewed text. The app binds to `127.0.0.1:4317`; it has no public deployment path.

## Local setup

Requirements: Node.js 22 or newer, npm, and Docker Compose.

```sh
docker compose up -d
npm ci
npm run seed
npm run build
npm start
```

If a local FalkorDB service already runs on `127.0.0.1:6379`, skip `docker compose up -d`. Open `http://127.0.0.1:4317`. The seed command writes only when the configured graph is empty. It verifies an existing graph against the generated fixture and removes only rows marked by its own attempt if seeding fails. The bundled graph service uses the persistent Docker volume `graph-hacks-2026-g01-data`; do not use `docker compose down -v` unless you intend to remove that volume.

Without `OPENAI_API_KEY`, the UI stays read-only and makes no model call. To enable draft generation, provide the key to the local server process through its environment. The browser never receives it. No credential is included in this repository.

Useful checks:

```sh
npm test
npm run test:integration
npm run typecheck
npm run build
```

The integration test requires the local FalkorDB service. `npm run dev` starts a watched development server. Run the separate T06 performance evaluation with `npm run evaluate:performance`; it reads the graph and writes evidence under ignored `work/`.

## Evidence flow

1. Choose a service and ask about impact, prerequisites, ownership, current rationale or decision history.
2. Review the returned paths, typed facts, source anchors, completeness and gaps.
3. Open a cited source through the fixed same-origin endpoint.
4. Prepare a proposed review from the inspected evidence.
5. Confirm the exact text. A stale review requires fresh evidence and a new confirmation.

The synthetic graph contains 1,000 nodes and 3,000 directed edges. Fixture definitions and source excerpts are in [`fixtures/`](fixtures/); graph shape is documented in [`docs/schema.md`](docs/schema.md). Current evaluation limits are in [`docs/evaluation.md`](docs/evaluation.md).

## Project notes

- [`AI-ASSISTANCE.md`](AI-ASSISTANCE.md) describes model use and current verification limits.
- [`PROVENANCE.md`](PROVENANCE.md) describes synthetic data and bundled fonts.
- [`CONTRIBUTIONS.md`](CONTRIBUTIONS.md) covers local development and data handling.
- [`SUBMISSION.md`](SUBMISSION.md) is a draft submission summary, not a submission receipt.
- [`docs/demo-script.md`](docs/demo-script.md) is a recording script. No demo video is included.
