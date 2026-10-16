import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { EvidenceReport, EvidenceSource, IntentKey } from '../contracts.js';
import { createReadWorkflow } from '../agent/draft.js';
import { ReadAgentError, type ResponsesProvider } from '../agent/types.js';
import { GraphStoreError } from '../graph/store.js';
import { ReviewError, type ReviewDraft } from '../memory/review.js';
import { ReviewManager, type ReviewStorePort } from '../memory/save.js';
import {
  BoundaryError,
  LOCAL_ORIGIN,
  hasExactKeys,
  isPlainObject,
  readJsonBody,
  validateHost,
  validatePostHeaders,
} from './boundary.js';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const STATIC_ASSETS = new Map<string, { file: string; contentType: string }>([
  ['/', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  ['/fonts/geist-sans.woff2', { file: 'fonts/geist-sans.woff2', contentType: 'font/woff2' }],
  ['/fonts/geist-mono.woff2', { file: 'fonts/geist-mono.woff2', contentType: 'font/woff2' }],
  ['/fonts/LICENSE.txt', { file: 'fonts/LICENSE.txt', contentType: 'text/plain; charset=utf-8' }],
]);

const ALLOWED_ERROR_CODES = new Set([
  'invalid_host', 'invalid_origin', 'invalid_content_type', 'unsupported_content_encoding', 'invalid_nonce',
  'invalid_content_length', 'body_too_large', 'body_timeout', 'request_aborted', 'request_error', 'invalid_json',
  'invalid_request', 'unknown_target', 'unsupported_intent', 'graph_unavailable', 'incomplete_evidence',
  'invalid_model_output', 'drafting_unavailable', 'stale_review', 'review_expired', 'intent_conflict',
  'integrity_failure', 'uncertain_write',
]);

const ERROR_MESSAGES: Record<string, string> = {
  invalid_host: 'Request host is not allowed',
  invalid_origin: 'Request origin is not allowed',
  invalid_content_type: 'Only UTF-8 JSON requests are accepted',
  unsupported_content_encoding: 'Compressed request bodies are not accepted',
  invalid_nonce: 'Request session nonce is invalid',
  invalid_content_length: 'Content length is invalid',
  body_too_large: 'Request body exceeds the supported size',
  body_timeout: 'Request body deadline exceeded',
  request_aborted: 'Request body was interrupted',
  request_error: 'Request body could not be read',
  invalid_json: 'Request body is not valid UTF-8 JSON',
  invalid_request: 'Request fields do not match the supported contract',
  unknown_target: 'Unknown service ID',
  unsupported_intent: 'Question could not be mapped to a supported read intent',
  graph_unavailable: 'Graph service is unavailable',
  incomplete_evidence: 'Graph evidence is incomplete',
  invalid_model_output: 'Drafting returned an invalid response',
  drafting_unavailable: 'Drafting is unavailable',
  stale_review: 'Evidence changed after review; create a fresh review',
  review_expired: 'Review expired or needs fresh participant confirmation',
  intent_conflict: 'Review request conflicts with persisted intent',
  integrity_failure: 'Review or evidence integrity check failed',
  uncertain_write: 'Save outcome is uncertain; check read-only review status',
  internal_error: 'Request failed safely',
};

export interface HttpGraphPort extends ReviewStorePort {
  entities(): Promise<Array<{ id: string; name: string }>>;
  inspect(targetId: string, intent: IntentKey): Promise<EvidenceReport>;
  source(requestId: string, revisionId: string, anchor: string): Promise<EvidenceSource>;
}

export interface HttpServerOptions {
  graph: HttpGraphPort;
  reviews: ReviewManager;
  provider: ResponsesProvider | null;
  publicDir?: string;
}

export function createLocalHttpServer(options: HttpServerOptions): Server {
  const sessionNonce = randomBytes(32).toString('base64url');
  const publicDir = options.publicDir ?? resolve(process.cwd(), 'public');
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, sessionNonce, publicDir);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpServerOptions,
  sessionNonce: string,
  publicDir: string,
): Promise<void> {
  setSecurityHeaders(response);
  try {
    validateHost(request);
    if (request.method === 'HEAD') {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url ?? '/', LOCAL_ORIGIN);
    if (request.method === 'GET') {
      await handleGet(url, response, options, sessionNonce, publicDir);
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'invalid_request', message: 'Method is not supported' } }, sessionNonce);
      return;
    }
    validatePostHeaders(request, sessionNonce);
    const body = await readJsonBody(request);
    await handlePost(url, body, response, options);
  } catch (error) {
    const info = publicError(error);
    if (error instanceof BoundaryError && (error.status === 408 || error.status === 413)) response.setHeader('Connection', 'close');
    sendJson(response, info.status, { error: { code: info.code, message: info.message } });
    if (error instanceof BoundaryError && (error.status === 408 || error.status === 413)) {
      response.once('finish', () => request.destroy());
    }
  }
}

async function handleGet(
  url: URL,
  response: ServerResponse,
  options: HttpServerOptions,
  sessionNonce: string,
  publicDir: string,
): Promise<void> {
  if (url.pathname === '/api/health') {
    if (url.search) throw new BoundaryError(400, 'invalid_request', 'Health route does not accept query parameters');
    let graph: 'available' | 'unavailable' = 'available';
    try { await options.graph.entities(); } catch { graph = 'unavailable'; }
    sendJson(response, 200, { graph, model: options.provider ? 'configured' : 'missing' }, sessionNonce);
    return;
  }

  if (url.pathname === '/api/entities') {
    if (url.search) throw new BoundaryError(400, 'invalid_request', 'Entity route does not accept query parameters');
    const entities = await options.graph.entities();
    sendJson(response, 200, {
      entities: entities.slice(0, 500).map(({ id, name }) => ({
        id: boundedId(id, 'service ID'),
        name: boundedText(name, 512, 'service name'),
      })),
      truncated: entities.length > 500,
    });
    return;
  }

  if (url.pathname === '/api/source') {
    const query = exactQuery(url, ['requestId', 'revisionId', 'anchor']);
    const source = await options.graph.source(
      boundedId(query.requestId, 'request ID'),
      boundedId(query.revisionId, 'revision ID'),
      boundedId(query.anchor, 'source anchor'),
    );
    sendJson(response, 200, { source });
    return;
  }

  if (url.pathname === '/api/reviews/status') {
    const query = exactQuery(url, ['requestId', 'digest']);
    const requestId = boundedId(query.requestId, 'request ID');
    const digest = boundedText(query.digest, 64, 'intent digest');
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new BoundaryError(400, 'invalid_request', 'Intent digest is invalid');
    const status = await options.reviews.status(requestId, digest);
    sendJson(response, 200, { status });
    return;
  }

  const asset = STATIC_ASSETS.get(url.pathname);
  if (!asset || url.search) {
    sendJson(response, 404, { error: { code: 'invalid_request', message: 'Route not found' } });
    return;
  }
  const contents = await readFile(resolve(publicDir, asset.file));
  setSecurityHeaders(response);
  response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': contents.byteLength });
  response.end(contents);
}

async function handlePost(url: URL, body: unknown, response: ServerResponse, options: HttpServerOptions): Promise<void> {
  if (!isPlainObject(body)) throw new BoundaryError(400, 'invalid_request', 'JSON body must be an object');

  if (url.pathname === '/api/question') {
    requireNoQuery(url);
    if (!hasExactKeys(body, ['targetId', 'question'])) throw new BoundaryError(400, 'invalid_request', ERROR_MESSAGES.invalid_request!);
    const targetId = boundedId(body.targetId, 'target ID');
    const question = boundedText(body.question, 500, 'question');
    if (!options.provider) throw new ReadAgentError('drafting_unavailable', ERROR_MESSAGES.drafting_unavailable!);
    const targetExists = (await options.graph.entities()).some((entity) => entity.id === targetId);
    if (!targetExists) throw new GraphStoreError('unknown_target', ERROR_MESSAGES.unknown_target!);
    const workflow = createReadWorkflow(options.provider, { targetId, question });
    const intent = await workflow.selectIntent();
    const report = await options.graph.inspect(targetId, intent);
    try {
      const draft = await workflow.draft(report);
      sendJson(response, 200, { status: report.status, intent, report, draft });
    } catch (error) {
      const info = publicError(error);
      sendJson(response, 200, {
        status: 'drafting_unavailable', intent, report,
        error: { code: info.code, message: info.message },
      });
    }
    return;
  }

  if (url.pathname === '/api/reviews') {
    requireNoQuery(url);
    const draft = parseReviewDraft(body);
    const intent = await options.reviews.prepare(draft);
    sendJson(response, 201, {
      status: 'pending',
      review: {
        requestId: intent.requestId,
        decisionId: intent.decisionId,
        subjectId: intent.subjectId,
        decisionKey: intent.decisionKey,
        text: intent.text,
        rationale: intent.rationale,
        reviewerId: intent.reviewerId,
        expectedPredecessorId: intent.expectedPredecessorId,
        citations: intent.citations,
        digest: intent.digest,
        confirmationNonce: intent.confirmationNonce,
        createdAt: intent.createdAt,
      },
    });
    return;
  }

  if (url.pathname === '/api/reviews/confirm') {
    requireNoQuery(url);
    if (!hasExactKeys(body, ['requestId', 'expectedDigest', 'confirmationNonce', 'participantConfirmed'])) {
      throw new BoundaryError(400, 'invalid_request', ERROR_MESSAGES.invalid_request!);
    }
    const requestId = boundedId(body.requestId, 'request ID');
    const expectedDigest = boundedText(body.expectedDigest, 64, 'intent digest');
    const confirmationNonce = boundedText(body.confirmationNonce, 128, 'review confirmation');
    if (!/^[a-f0-9]{64}$/.test(expectedDigest) || body.participantConfirmed !== true) {
      throw new BoundaryError(400, 'invalid_request', 'Explicit review confirmation is required');
    }
    const result = await options.reviews.confirm({ requestId, expectedDigest, confirmationNonce, participantConfirmed: true });
    sendJson(response, 200, { status: result.state, decisionId: result.decisionId, classification: result.classification });
    return;
  }

  sendJson(response, 404, { error: { code: 'invalid_request', message: 'Route not found' } });
}

function parseReviewDraft(body: Record<string, unknown>): ReviewDraft {
  const required = ['subjectId', 'decisionKey', 'text', 'rationale', 'reviewerId', 'citations'];
  if (!hasExactKeys(body, required, ['expectedPredecessorId'])) {
    throw new BoundaryError(400, 'invalid_request', ERROR_MESSAGES.invalid_request!);
  }
  if (!Array.isArray(body.citations) || body.citations.length < 1 || body.citations.length > 100) {
    throw new BoundaryError(400, 'invalid_request', 'Review must cite between 1 and 100 source anchors');
  }
  const citations = body.citations.map((value) => {
    if (!isPlainObject(value) || !hasExactKeys(value, ['revisionId', 'anchor', 'contentDigest'])) {
      throw new BoundaryError(400, 'invalid_request', ERROR_MESSAGES.invalid_request!);
    }
    const revisionId = boundedId(value.revisionId, 'revision ID');
    const anchor = boundedId(value.anchor, 'source anchor');
    const contentDigest = boundedText(value.contentDigest, 64, 'content digest');
    if (!/^[a-f0-9]{64}$/.test(contentDigest)) throw new BoundaryError(400, 'invalid_request', 'Source digest is invalid');
    return { revisionId, anchor, contentDigest };
  });
  let expectedPredecessorId: string | null | undefined;
  if (Object.hasOwn(body, 'expectedPredecessorId')) {
    if (body.expectedPredecessorId !== null) expectedPredecessorId = boundedId(body.expectedPredecessorId, 'predecessor ID');
    else expectedPredecessorId = null;
  }
  return {
    subjectId: boundedId(body.subjectId, 'subject ID'),
    decisionKey: boundedId(body.decisionKey, 'decision key'),
    text: boundedText(body.text, 8192, 'decision text'),
    rationale: boundedText(body.rationale, 8192, 'rationale'),
    reviewerId: boundedId(body.reviewerId, 'reviewer ID'),
    citations,
    ...(expectedPredecessorId === undefined ? {} : { expectedPredecessorId }),
  };
}

function boundedId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BoundaryError(400, 'invalid_request', `${name} must contain 1 to 128 safe characters`);
  }
  return value;
}

function boundedText(value: unknown, maxCodePoints: number, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || [...value].length > maxCodePoints) {
    throw new BoundaryError(400, 'invalid_request', `${name} must contain 1 to ${maxCodePoints} characters`);
  }
  return value;
}

function exactQuery(url: URL, expected: string[]): Record<string, string> {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))
    || expected.some((key) => url.searchParams.getAll(key).length !== 1)) {
    throw new BoundaryError(400, 'invalid_request', 'Query parameters do not match the supported contract');
  }
  return Object.fromEntries(expected.map((key) => [key, url.searchParams.get(key)!]));
}

function requireNoQuery(url: URL): void {
  if (url.search) throw new BoundaryError(400, 'invalid_request', 'Route does not accept query parameters');
}

function setSecurityHeaders(response: ServerResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(key, value);
}

function sendJson(response: ServerResponse, status: number, payload: unknown, sessionNonce?: string): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (sessionNonce) response.setHeader('X-Session-Nonce', sessionNonce);
  setSecurityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.byteLength });
  response.end(body);
}

function publicError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof BoundaryError) return { status: error.status, code: error.code, message: error.message };
  const rawCode = error instanceof GraphStoreError || error instanceof ReadAgentError || error instanceof ReviewError
    ? error.code
    : isPlainObject(error) && typeof error.code === 'string' ? error.code : 'internal_error';
  const code = ALLOWED_ERROR_CODES.has(rawCode) ? rawCode : 'internal_error';
  const status = code === 'unknown_target' ? 404
    : code === 'invalid_model_output' ? 502
      : code === 'drafting_unavailable' || code === 'graph_unavailable' || code === 'uncertain_write' ? 503
        : code === 'incomplete_evidence' ? 409
          : code === 'invalid_request' || code === 'unsupported_intent' ? 400
            : code === 'internal_error' ? 500 : 409;
  return { status, code, message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error! };
}
