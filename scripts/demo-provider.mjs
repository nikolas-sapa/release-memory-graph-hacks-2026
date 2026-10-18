import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = 4318;
const MAX_BODY_BYTES = 65_536;
const MAX_CONNECTIONS = 8;
const REQUEST_TIMEOUT_MS = 5_000;

const server = createServer(async (request, response) => {
  request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy());

  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    response.writeHead(404).end();
    return;
  }

  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const format = body?.text?.format?.name;
    let output;
    if (format === 'read_intent') {
      output = JSON.stringify({ intent: 'impact' });
    } else if (format === 'evidence_draft') {
      const report = JSON.parse(body.input);
      const factIds = Array.isArray(report.facts)
        ? report.facts.slice(0, 5).map((fact) => fact.id)
        : [];
      output = JSON.stringify({ factIds, actions: [] });
    } else {
      response.writeHead(400).end();
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      id: 'resp_local_demo',
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: body.model || 'local-demo-stub',
      output: [{
        id: 'msg_local_demo',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: output, annotations: [] }],
      }],
    }));
  } catch {
    response.writeHead(400).end();
  }
});

server.maxConnections = MAX_CONNECTIONS;

server.listen(PORT, HOST, () => {
  process.stdout.write(`Deterministic demo stub on http://${HOST}:${PORT}/v1; no external model calls.\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
