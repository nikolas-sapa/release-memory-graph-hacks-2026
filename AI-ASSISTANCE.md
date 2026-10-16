# AI assistance disclosure

OpenAI Codex assisted with architecture integration, TypeScript implementation, tests, local UI and documentation. The fixture authoring record is in [`fixtures/oracle-ledger.md`](fixtures/oracle-ledger.md); it records that no human oracle reviewer has signed off. No participant explanation or human evaluation result is represented as completed.

The app includes an optional OpenAI Responses adapter for intent selection and draft text. Server code validates model references against retrieved evidence and renders facts from graph records. A missing credential disables drafting. No live provider call or paid API request was made during this work, so provider availability and live inference quality remain unverified.

The source tree, synthetic graph, local tests and browser rendering were reviewed. Those checks do not replace independent human review, provider evaluation, the participant assessment, or a recorded demo.
