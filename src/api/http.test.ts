import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient, REQUEST_TIMEOUT_MS } from './http';
import { isSessionError } from './errors';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('HTTP failures', () => {
  it('preserves structured error metadata with a localized message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'session_not_found', message: 'Session expired' },
            request_id: 'server-request',
          }),
          { status: 404 },
        ),
      ),
    );
    const error = await createHttpClient('/backend/api')('/cart').catch((error: unknown) => error);
    expect(error).toMatchObject({
      status: 404,
      code: 'session_not_found',
      requestId: 'server-request',
      message: expect.stringContaining('истекло'),
    });
    expect(isSessionError(error)).toBe(true);
  });

  it('handles a proxy HTML error and uses the response request ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Unavailable</html>', {
          status: 502,
          headers: { 'X-Request-ID': 'proxy-request' },
        }),
      ),
    );
    await expect(createHttpClient('/backend/api')('/health/ready')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
      requestId: 'proxy-request',
      message: expect.stringContaining('HTTP 502'),
    });
  });

  it.each(['', '<html>Not JSON</html>', 'null'])(
    'rejects malformed successful body %j',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      await expect(createHttpClient('/backend/api')('/health/ready')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );

  it('reports network failures without retrying', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createHttpClient('/backend/api')('/health/ready')).rejects.toMatchObject({
      code: 'network_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows the backend 90-second operation and aborts only at 120 seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = expect(createHttpClient('/backend/api')('/chat')).rejects.toMatchObject({
      code: 'request_timeout',
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 90_000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
