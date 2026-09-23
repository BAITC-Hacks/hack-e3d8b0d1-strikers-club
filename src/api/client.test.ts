import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './client';
import { ApiError } from './errors';
import {
  cartFixture,
  chatFixture,
  jsonResponse,
  productFixture,
  proposalFixture,
  resultFixture,
  sessionFixture,
} from './fixtures';

const sessionId = sessionFixture.session_id;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFetch(responses: unknown[]) {
  const mock = vi.fn().mockImplementation(async () => jsonResponse(responses.shift()));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('live API contract', () => {
  it('uses documented routes with raw files and exact confirmation fields', async () => {
    const fetchMock = mockFetch([
      sessionFixture,
      chatFixture,
      chatFixture,
      productFixture,
      resultFixture,
      cartFixture,
      { status: 'ok', redis: 'ok' },
    ]);
    const api = createApi({ mode: 'live', baseUrl: 'https://bff.example/backend/api/' });
    expect(await api.start()).toEqual({ session_id: sessionId, expires_in: 3600 });
    await api.chat(sessionId, ' Кабель ');
    const file = new File(['PDF'], 'чертёж.PDF', { type: 'application/pdf' });
    await api.upload(sessionId, file);
    await api.product('51/52');
    await api.confirm(sessionId, proposalFixture);
    await api.cart(sessionId);
    await api.health();
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url.replace('https://bff.example/backend/api', ''))).toEqual([
      '/chat/sessions',
      '/chat',
      `/chat/upload?session_id=${sessionId}`,
      '/products/51%2F52',
      '/cart/items',
      `/cart?session_id=${sessionId}`,
      '/health/ready',
    ]);
    expect(calls[0][1].method).toBe('POST');
    expect(calls[0][1].body).toBeUndefined();
    expect(JSON.parse(calls[1][1].body as string)).toEqual({
      session_id: sessionId,
      message: 'Кабель',
    });
    expect(calls[2][1].body).toBe(file);
    const uploadHeaders = new Headers(calls[2][1].headers);
    expect(uploadHeaders.get('Content-Type')).toBe('application/pdf');
    expect(uploadHeaders.get('X-Filename')).toBe('attachment.pdf');
    expect(JSON.parse(calls[4][1].body as string)).toEqual({
      session_id: sessionId,
      operation_id: proposalFixture.operation_id,
      product_id: productFixture.id,
      quantity: 2,
    });
    calls.forEach(([, init], index) => {
      const headers = new Headers(init.headers);
      expect(headers.has('X-API-Key')).toBe(false);
      expect(headers.get('X-Request-ID')).toMatch(/^[a-zA-Z0-9_.-]{1,64}$/);
      expect(headers.get('X-Session-Token')).toBe(
        [1, 2, 4, 5].includes(index) ? sessionFixture.session_token : null,
      );
      expect(init.cache).toBe('no-store');
    });
  });

  it('deduplicates concurrent starts and creates a fresh session on a later start', async () => {
    const fetchMock = mockFetch([sessionFixture, { ...sessionFixture, session_id: 'new-session' }]);
    const api = createApi({ mode: 'live' });
    const first = api.start();
    expect(api.start()).toBe(first);
    expect(await first).not.toHaveProperty('session_token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await api.start()).session_id).toBe('new-session');
    await expect(api.chat(sessionId, 'test')).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('blocks concurrent session operations while allowing product details', async () => {
    let resolveChat!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(sessionFixture))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveChat = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse(productFixture));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApi({ mode: 'live' });
    await api.start();
    const pending = api.chat(sessionId, 'Кабель');
    await expect(api.cart(sessionId)).rejects.toMatchObject({ code: 'session_busy' });
    await expect(api.confirm(sessionId, proposalFixture)).rejects.toMatchObject({
      code: 'session_busy',
    });
    await expect(api.start()).rejects.toMatchObject({ code: 'session_busy' });
    expect(await api.product(productFixture.id)).toEqual(productFixture);
    resolveChat(jsonResponse(chatFixture));
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['session_not_found', 'session_unauthorized'])(
    'discards session access on %s',
    async (code) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sessionFixture))
        .mockResolvedValueOnce(
          jsonResponse({ error: { code, message: 'expired' }, request_id: 'request-42' }, 404),
        );
      vi.stubGlobal('fetch', fetchMock);
      const api = createApi({ mode: 'live' });
      await api.start();
      await expect(api.cart(sessionId)).rejects.toMatchObject({ code, requestId: 'request-42' });
      await expect(api.cart(sessionId)).rejects.toMatchObject({ code: 'session_not_found' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('allows an exact manual confirmation retry without automatically retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(sessionFixture))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(resultFixture));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApi({ mode: 'live' });
    await api.start();
    await expect(api.confirm(sessionId, proposalFixture)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await api.confirm(sessionId, proposalFixture)).toEqual(resultFixture);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
  });

  it('does not treat HTTP 200 reconfirmation as an added item', async () => {
    const result = {
      ...resultFixture,
      status: 'reconfirmation_required',
      success: false,
      pending_cart_action: proposalFixture,
    };
    mockFetch([sessionFixture, result]);
    const api = createApi({ mode: 'live' });
    await api.start();
    expect(await api.confirm(sessionId, proposalFixture)).toEqual(result);
  });

  it('defaults to the same-origin live BFF', async () => {
    vi.stubEnv('VITE_API_MODE', '');
    vi.stubEnv('VITE_API_BASE_URL', '/backend/api');
    const fetchMock = mockFetch([sessionFixture]);
    const api = createApi();
    expect(api.mode).toBe('live');
    await api.start();
    expect(fetchMock.mock.calls[0][0]).toBe('/backend/api/chat/sessions');
  });
});
