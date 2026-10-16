import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const LOCAL_HOST = '127.0.0.1:4317';
export const LOCAL_ORIGIN = `http://${LOCAL_HOST}`;
export const MAX_BODY_BYTES = 65_536;
export const BODY_DEADLINE_MS = 5_000;

export class BoundaryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'BoundaryError';
  }
}

export function validateHost(request: IncomingMessage): void {
  if (request.headers.host !== LOCAL_HOST) {
    throw new BoundaryError(403, 'invalid_host', 'Request host is not allowed');
  }
}

export function validatePostHeaders(request: IncomingMessage, sessionNonce: string): void {
  if (request.headers.origin !== LOCAL_ORIGIN) {
    throw new BoundaryError(403, 'invalid_origin', 'Request origin is not allowed');
  }

  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new BoundaryError(415, 'invalid_content_type', 'Only UTF-8 JSON requests are accepted');
  }

  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new BoundaryError(415, 'unsupported_content_encoding', 'Compressed request bodies are not accepted');
  }

  const candidate = request.headers['x-session-nonce'];
  if (typeof candidate !== 'string' || !sameSecret(candidate, sessionNonce)) {
    throw new BoundaryError(403, 'invalid_nonce', 'Request session nonce is invalid');
  }

  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) throw new BoundaryError(400, 'invalid_content_length', 'Content length is invalid');
    if (Number(contentLength) > MAX_BODY_BYTES) throw new BoundaryError(413, 'body_too_large', 'Request body exceeds the supported size');
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('error', onError);
    };
    const fail = (error: BoundaryError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      request.pause();
      reject(error);
    };
    const timer = setTimeout(() => fail(new BoundaryError(408, 'body_timeout', 'Request body deadline exceeded')), BODY_DEADLINE_MS);
    timer.unref();
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_BODY_BYTES) {
        fail(new BoundaryError(413, 'body_too_large', 'Request body exceeds the supported size'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new BoundaryError(400, 'invalid_json', 'Request body is not valid UTF-8 JSON'));
      }
    };
    const onAborted = (): void => fail(new BoundaryError(400, 'request_aborted', 'Request body was interrupted'));
    const onError = (): void => fail(new BoundaryError(400, 'request_error', 'Request body could not be read'));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
  });
}

function sameSecret(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
