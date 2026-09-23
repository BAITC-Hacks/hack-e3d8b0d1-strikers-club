// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backendConfig } from './config';
import { createBackendProxy } from './proxy';

type Captured = { url?: string; method?: string; headers: Record<string, unknown>; body: Buffer };
let servers: Server[];
let captures: Captured[];
let replyStatus: number;
let reply: string;
let replyHeaders: Record<string, string>;
let upstreamUrl: string;
let replyDelay: number;

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function proxy(key = 'server-only-secret', extra = {}) {
  const config = { ...backendConfig({ BACKEND_URL: upstreamUrl, BACKEND_API_KEY: key }), ...extra };
  const handle = createBackendProxy(config);
  return listen(
    createServer((request, response) => {
      handle(request, response, () => {
        response.writeHead(404).end();
      });
    }),
  );
}

beforeEach(async () => {
  servers = [];
  captures = [];
  replyStatus = 200;
  reply = JSON.stringify({ ok: true });
  replyHeaders = {};
  replyDelay = 0;
  upstreamUrl = await listen(
    createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      captures.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      if (replyDelay) await new Promise((resolve) => setTimeout(resolve, replyDelay));
      response
        .writeHead(replyStatus, { 'Content-Type': 'application/json', ...replyHeaders })
        .end(reply);
    }),
  );
});

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('same-origin backend proxy', () => {
  it('injects only the server key and preserves session creation status', async () => {
    const base = await proxy();
    replyStatus = 201;
    const response = await fetch(`${base}/backend/api/chat/sessions`, {
      method: 'POST',
      headers: { 'X-API-Key': 'browser-forgery', Cookie: 'private=1', Authorization: 'unused' },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(captures[0].url).toBe('/api/chat/sessions');
    expect(captures[0].headers['x-api-key']).toBe('server-only-secret');
    expect(captures[0].headers).not.toHaveProperty('cookie');
    expect(captures[0].headers).not.toHaveProperty('authorization');
    expect(captures[0].body.length).toBe(0);
    expect(await response.text()).not.toContain('server-only-secret');
  });

  it('preserves raw uploads, MIME, filename, token and request ID', async () => {
    const base = await proxy();
    const body = new Uint8Array([0, 255, 2, 8, 100]);
    await fetch(`${base}/backend/api/chat/upload?session_id=example`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/pdf',
        'X-Filename': 'attachment.pdf',
        'X-Session-Token': 'opaque-token',
        'X-Request-ID': 'request-123',
      },
    });
    expect(captures[0].body).toEqual(Buffer.from(body));
    expect(captures[0].headers).toMatchObject({
      'content-type': 'application/pdf',
      'x-filename': 'attachment.pdf',
      'x-session-token': 'opaque-token',
      'x-request-id': 'request-123',
    });
    expect(captures[0].url).toBe('/api/chat/upload?session_id=example');
  });

  it('forwards structured errors, status and backend request ID', async () => {
    const base = await proxy();
    replyStatus = 409;
    replyHeaders = { 'X-Request-ID': 'backend-id', 'Set-Cookie': 'must-not-leak=1' };
    reply = JSON.stringify({ error: { code: 'session_busy' }, request_id: 'backend-id' });
    const response = await fetch(`${base}/backend/api/cart?session_id=example`, {
      headers: { 'X-Session-Token': 'opaque-token' },
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('x-request-id')).toBe('backend-id');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe(reply);
  });

  it('requires the server key but permits anonymous health checks', async () => {
    const base = await proxy('');
    const missingKey = await fetch(`${base}/backend/api/chat/sessions`, { method: 'POST' });
    expect(missingKey.status).toBe(503);
    expect((await missingKey.json()).error.code).toBe('integration_not_configured');
    const health = await fetch(`${base}/backend/api/health/ready`);
    expect(health.status).toBe(200);
    expect(captures[0].headers).not.toHaveProperty('x-api-key');
  });

  it('blocks unknown routes, wrong methods, extra query fields and missing tokens', async () => {
    const base = await proxy();
    for (const [path, status] of [
      ['/docs', 404],
      ['/cart/prepare', 404],
      ['/chat/sessions', 405],
      ['/health?url=http://attacker.test', 422],
      ['/cart?session_id=example', 401],
    ] as const) {
      expect((await fetch(`${base}/backend/api${path}`)).status).toBe(status);
    }
    expect(captures).toHaveLength(0);
  });

  it('rejects cross-origin browser requests before contacting backend', async () => {
    const base = await proxy();
    const response = await fetch(`${base}/backend/api/health`, {
      headers: { Origin: 'https://other.example' },
    });
    expect(response.status).toBe(403);
    expect(captures).toHaveLength(0);
  });

  it('accepts the configured HTTPS public origin behind a reverse proxy', async () => {
    const base = await proxy(undefined, { publicOrigin: 'https://shop.example' });
    const response = await fetch(`${base}/backend/api/health`, {
      headers: { Origin: 'https://shop.example' },
    });
    expect(response.status).toBe(200);
  });

  it('rejects oversized bodies and multipart uploads locally', async () => {
    const base = await proxy(undefined, { jsonLimit: 4, uploadLimit: 4 });
    for (const path of ['/chat', '/chat/upload?session_id=example']) {
      const response = await fetch(`${base}/backend/api${path}`, {
        method: 'POST',
        body: '12345',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': 'token',
          'X-Filename': 'attachment.pdf',
        },
      });
      expect(response.status).toBe(413);
    }
    const multipart = await fetch(`${base}/backend/api/chat/upload?session_id=example`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
        'X-Session-Token': 'token',
        'X-Filename': 'attachment.pdf',
      },
    });
    expect(multipart.status).toBe(415);
    expect(captures).toHaveLength(0);
  });

  it('does not follow upstream redirects or leak the key to another origin', async () => {
    const base = await proxy();
    replyStatus = 307;
    replyHeaders = { Location: 'https://other.example' };
    const response = await fetch(`${base}/backend/api/health`);
    expect(response.status).toBe(502);
    expect(captures).toHaveLength(1);
  });

  it('returns a structured failure when backend is not running', async () => {
    const base = await proxy();
    await new Promise<void>((resolve) => servers[0].close(() => resolve()));
    const response = await fetch(`${base}/backend/api/health`);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('upstream_unavailable');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('bounds the backend wait and returns a retryable error on timeout', async () => {
    const base = await proxy(undefined, { timeoutMs: 10 });
    replyDelay = 100;
    const response = await fetch(`${base}/backend/api/health`);
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('upstream_unavailable');
  });
});
