import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from './body.js';
import type { BackendConfig } from './config.js';
import { ProxyError, sendError } from './errors.js';
import { upstreamHeaders } from './headers.js';
import { matchRoute } from './routes.js';
import { checkOrigin, createRateLimiter } from './security.js';

type Next = () => void;
const validRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value);

export function createBackendProxy(config: BackendConfig) {
  const limit = createRateLimiter();
  return (request: IncomingMessage, response: ServerResponse, next: Next) => {
    const rawUrl = request.url || '/';
    if (!/^\/backend\/api(?:[/?]|$)/.test(rawUrl)) {
      next();
      return;
    }
    const clientId = request.headers['x-request-id'];
    const requestId = validRequestId(clientId) ? clientId : randomUUID();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    void forward(request, response, config, requestId, limit).catch((error: unknown) => {
      const failure =
        error instanceof ProxyError
          ? error
          : new ProxyError(
              502,
              'upstream_unavailable',
              'Backend недоступен. Проверьте, что сервер запущен.',
            );
      if (failure.status === 429) response.setHeader('Retry-After', '60');
      sendError(response, failure, requestId);
    });
  };
}

async function forward(
  request: IncomingMessage,
  response: ServerResponse,
  config: BackendConfig,
  requestId: string,
  limit: ReturnType<typeof createRateLimiter>,
) {
  checkOrigin(request, config);
  const route = matchRoute(new URL(request.url || '/', 'http://localhost'), request.method);
  limit(request, route.path === '/chat/sessions');
  const headers = upstreamHeaders(request, route, config, requestId);
  const maxBytes = route.upload
    ? config.uploadLimit
    : route.path === '/chat/sessions'
      ? 0
      : config.jsonLimit;
  const body = request.method === 'POST' ? await readBody(request, maxBytes) : undefined;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.timeoutMs);
  const onClose = () => {
    if (!response.writableEnded) abort.abort();
  };
  response.once('close', onClose);
  try {
    const upstream = await fetch(`${config.origin}${config.prefix}${route.path}${route.search}`, {
      method: request.method,
      headers,
      body: body?.length ? new Uint8Array(body) : undefined,
      redirect: 'manual',
      signal: abort.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      throw new ProxyError(
        502,
        'upstream_unavailable',
        'Backend вернул неожиданный адрес перенаправления.',
      );
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (response.destroyed) return;
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    const upstreamId = upstream.headers.get('x-request-id');
    if (validRequestId(upstreamId)) response.setHeader('X-Request-ID', upstreamId);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter && /^\d{1,6}$/.test(retryAfter)) response.setHeader('Retry-After', retryAfter);
    response.end(bytes);
  } finally {
    clearTimeout(timer);
    response.off('close', onClose);
  }
}
