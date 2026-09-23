import { ProxyError } from './errors.js';

export interface Route {
  path: string;
  search: string;
  health: boolean;
  session: boolean;
  upload: boolean;
}

export function matchRoute(url: URL, method?: string): Route {
  const path = url.pathname.slice('/backend/api'.length);
  const health = /^\/health(?:\/(?:live|ready))?$/.test(path);
  const post = ['/chat/sessions', '/chat', '/chat/upload', '/cart/items'].includes(path);
  const get = health || path === '/cart' || /^\/products\/[^/]+$/.test(path);
  if (!get && !post) throw new ProxyError(404, 'not_found', 'Маршрут API не найден.');
  if (method !== (post ? 'POST' : 'GET')) {
    throw new ProxyError(405, 'method_not_allowed', 'Метод запроса не поддерживается.');
  }
  const querySession = path === '/cart' || path === '/chat/upload';
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== 'session_id' || !querySession) || keys.length > 1) {
    throw new ProxyError(422, 'validation_error', 'Недопустимые параметры запроса.');
  }
  if (querySession && !url.searchParams.get('session_id')) {
    throw new ProxyError(422, 'validation_error', 'Не указан идентификатор сессии.');
  }
  return {
    path,
    search: url.search,
    health,
    session: ['/chat', '/chat/upload', '/cart', '/cart/items'].includes(path),
    upload: path === '/chat/upload',
  };
}
