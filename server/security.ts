import type { IncomingMessage } from 'node:http';
import type { BackendConfig } from './config.js';
import { ProxyError } from './errors.js';

export function checkOrigin(request: IncomingMessage, config: BackendConfig) {
  const supplied = request.headers.origin;
  const expected = config.publicOrigin || `http://${request.headers.host}`;
  if (request.headers['sec-fetch-site'] === 'cross-site' || (supplied && supplied !== expected)) {
    throw new ProxyError(403, 'origin_not_allowed', 'Источник запроса не разрешён.');
  }
}

export function createRateLimiter(limit = 120, maxClients = 10_000) {
  const clients = new Map<string, { count: number; sessions: number; until: number }>();
  let nextCleanup = 0;
  return (request: IncomingMessage, sessionCreation: boolean) => {
    const now = Date.now();
    if (now >= nextCleanup) {
      for (const [key, client] of clients) if (client.until <= now) clients.delete(key);
      nextCleanup = now + 60_000;
    }
    // Forwarded headers are intentionally ignored: only the direct peer is trusted.
    const key = request.socket.remoteAddress || 'unknown';
    let client = clients.get(key);
    if (!client || client.until <= now) {
      if (!client && clients.size >= maxClients) {
        throw new ProxyError(429, 'rate_limited', 'Сервис занят. Попробуйте через минуту.');
      }
      client = { count: 0, sessions: 0, until: now + 60_000 };
      clients.set(key, client);
    }
    client.count += 1;
    if (sessionCreation) client.sessions += 1;
    if (client.count > limit || client.sessions > 10) {
      throw new ProxyError(429, 'rate_limited', 'Слишком много запросов. Попробуйте через минуту.');
    }
  };
}
