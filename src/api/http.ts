import { ApiError, responseError } from './errors';

export const REQUEST_TIMEOUT_MS = 120_000;

/** Transport never retries: a lost response may still have changed server state. */
export function createHttpClient(baseUrl: string) {
  return async function request(
    path: string,
    init: RequestInit = {},
    sessionToken?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('X-Request-ID', crypto.randomUUID());
    if (sessionToken) headers.set('X-Session-Token', sessionToken);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        method: init.method ?? 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        /* Proxies may return HTML. */
      }
      const requestId = response.headers.get('X-Request-ID');
      if (!response.ok) throw responseError(response.status, data, requestId);
      if (data === null)
        throw new ApiError(
          response.status,
          'invalid_response',
          'Сервис вернул пустой или некорректный ответ.',
          requestId,
        );
      return data;
    } catch (error) {
      if (controller.signal.aborted)
        throw new ApiError(
          0,
          'request_timeout',
          'Сервер не ответил за 120 секунд. Результат запроса неизвестен; повторите вручную.',
        );
      if (error instanceof TypeError)
        throw new ApiError(
          0,
          'network_error',
          'Не удалось подключиться к серверу. Проверьте соединение и попробуйте ещё раз.',
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
