import type { IncomingMessage } from 'node:http';
import type { BackendConfig } from './config.js';
import { ProxyError } from './errors.js';
import type { Route } from './routes.js';

export function upstreamHeaders(
  request: IncomingMessage,
  route: Route,
  config: BackendConfig,
  requestId: string,
) {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-ID': requestId };
  if (!route.health) {
    if (!config.apiKey) {
      throw new ProxyError(
        503,
        'integration_not_configured',
        'Серверный ключ backend ещё не настроен.',
      );
    }
    headers['X-API-Key'] = config.apiKey;
  }
  if (route.session) {
    const token = request.headers['x-session-token'];
    if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
      throw new ProxyError(401, 'session_unauthorized', 'Необходим токен сессии.');
    }
    // FastAPI checks that this opaque credential belongs to the requested session.
    headers['X-Session-Token'] = token;
  }
  if (request.headers['content-encoding']) {
    throw new ProxyError(415, 'unsupported_media_type', 'Сжатые тела запросов не поддерживаются.');
  }
  const type = request.headers['content-type'];
  if (route.upload) {
    const filename = request.headers['x-filename'];
    if (typeof filename !== 'string' || !/^[\x20-\x7e]{1,200}$/.test(filename)) {
      throw new ProxyError(422, 'validation_error', 'Укажите ASCII-имя файла до 200 символов.');
    }
    if (!type || type.toLowerCase().startsWith('multipart/')) {
      throw new ProxyError(
        415,
        'unsupported_media_type',
        'Отправьте сырые байты файла с Content-Type.',
      );
    }
    headers['X-Filename'] = filename;
    headers['Content-Type'] = type;
  } else if (request.method === 'POST' && route.path !== '/chat/sessions') {
    if (type?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ProxyError(415, 'unsupported_media_type', 'Ожидается JSON.');
    }
    headers['Content-Type'] = type;
  }
  return headers;
}
