import { GraphStore, GraphStoreError } from './graph/store.js';
import { readConfig } from './config.js';
import { openAIResponsesProvider } from './agent/intent.js';
import type { ResponsesProvider } from './agent/types.js';
import type { EvidenceReport, EvidenceSource, IntentKey } from './contracts.js';
import type { ReviewSnapshot } from './memory/review.js';
import { ReviewManager, type AtomicCommitResult, type PersistableReviewIntent, type ReceiptLookup } from './memory/save.js';
import { createLocalHttpServer, type HttpGraphPort } from './http/server.js';

const HOST = '127.0.0.1';
const PORT = 4317;

async function start(): Promise<void> {
  const graph = await connectGraph();
  const apiKey = process.env.OPENAI_API_KEY;
  const provider: ResponsesProvider | null = apiKey ? openAIResponsesProvider(apiKey) : null;
  const reviews = new ReviewManager(graph);
  const server = createLocalHttpServer({ graph, reviews, provider });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  process.stdout.write(`Release Memory listening on http://${HOST}:${PORT}\n`);

  const shutdown = (): void => {
    server.close(() => {
      const close = graph instanceof GraphStore ? graph.close() : Promise.resolve();
      void close.then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; });
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function connectGraph(): Promise<HttpGraphPort> {
  try {
    return await GraphStore.connect(readConfig());
  } catch {
    process.stderr.write('Graph service unavailable at startup. UI will show read-only outage state.\n');
    return unavailableGraph;
  }
}

const unavailableError = (): GraphStoreError => new GraphStoreError('graph_unavailable', 'Graph service is unavailable');

const unavailableGraph: HttpGraphPort = {
  async entities(): Promise<Array<{ id: string; name: string }>> { throw unavailableError(); },
  async inspect(_targetId: string, _intent: IntentKey): Promise<EvidenceReport> { throw unavailableError(); },
  async source(_requestId: string, _revisionId: string, _anchor: string): Promise<EvidenceSource> { throw unavailableError(); },
  async lookupReceipt(_requestId: string): Promise<ReceiptLookup> { return { state: 'unavailable' }; },
  async readSnapshot(_subjectId: string, _decisionKey: string): Promise<ReviewSnapshot> { throw unavailableError(); },
  async atomicCommit(_intent: PersistableReviewIntent): Promise<AtomicCommitResult> { return { state: 'uncertain' }; },
  async classifyDecision(_decisionId: string): Promise<'current' | 'historical' | 'unknown' | 'unavailable'> { return 'unavailable'; },
};

void start().catch(() => {
  process.stderr.write('Local HTTP server could not start on 127.0.0.1:4317.\n');
  process.exitCode = 1;
});
