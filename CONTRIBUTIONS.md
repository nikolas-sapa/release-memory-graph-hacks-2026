# Contributing

Keep changes local-first and evidence-backed. Do not add real customer, employee, incident or production graph data. Use synthetic records and stable IDs from `fixtures/` for tests.

Before proposing a change:

1. Read the relevant contracts, fixture oracle and evaluation protocol.
2. Add or update a meaningful test for changed behavior.
3. Run `npm test`, `npm run typecheck` and `npm run build`. Run `npm run test:integration` for graph-store changes.
4. Keep secrets out of source, test fixtures, screenshots and logs. The OpenAI key belongs only in the local server environment.

Graph queries must remain bounded and parameterized. Any change to review identity, citation binding, confirmation, persistence or retry behavior needs tests for stale evidence, retries and zero-partial-write outcomes. Do not change the synthetic oracle to match application output.

Use npm for package management. Keep the Graph service bound to loopback. No public deployment, external message, paid model call or submission is authorized by this contribution guide.
