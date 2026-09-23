import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantApi } from '../api/types';
import { ApiError } from '../api/errors';
import { chatFixture, sessionFixture, cartFixture, proposalFixture } from '../api/fixtures';
import { queryKeys } from '../api/queryKeys';
import { createAssistantStore, sessionStarted, setProposal } from '../state/store';
import { useMessaging } from './useMessaging';
import { useSession } from './useSession';

const clients: QueryClient[] = [];
function setup() {
  const api = {
    mode: 'live' as const,
    start: vi
      .fn<AssistantApi['start']>()
      .mockResolvedValue({ session_id: 'new-session', expires_in: 3600 }),
    upload: vi.fn<AssistantApi['upload']>(),
    chat: vi.fn<AssistantApi['chat']>().mockResolvedValue(chatFixture),
    product: vi.fn<AssistantApi['product']>(),
    confirm: vi.fn<AssistantApi['confirm']>(),
    cart: vi.fn<AssistantApi['cart']>(),
    health: vi.fn<AssistantApi['health']>(),
  };
  const store = createAssistantStore();
  const id = sessionFixture.session_id;
  store.dispatch(sessionStarted(id));
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0 } } });
  clients.push(cache);
  const view = renderHook(
    () => {
      const session = useSession(api);
      const composer = useMessaging(api, session);
      return { session, ...composer };
    },
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <Provider store={store}>
          <QueryClientProvider client={cache}>{children}</QueryClientProvider>
        </Provider>
      ),
    },
  );
  return { ...view, api, store, cache, id };
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('sequential message submission', () => {
  it('retries only unfinished uploads and never forwards invented attachment IDs', async () => {
    const { api, store, result, id } = setup();
    const first = new File(['first'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['second'], 'second.pdf', { type: 'application/pdf' });
    api.upload
      .mockResolvedValueOnce({ ...chatFixture, message: 'Первый файл' })
      .mockRejectedValueOnce(new Error('Повторите отправку'))
      .mockResolvedValueOnce({ ...chatFixture, message: 'Второй файл' });
    act(() => {
      result.current.setDraft('Сравни файлы');
      result.current.attach([first, second]);
    });
    expect(api.upload).not.toHaveBeenCalled();
    act(() => result.current.send());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.draft).toBe('Сравни файлы');
    expect(api.chat).not.toHaveBeenCalled();
    act(() => result.current.send());
    await waitFor(() => expect(api.chat).toHaveBeenCalledExactlyOnceWith(id, 'Сравни файлы'));
    expect(api.upload.mock.calls.map(([, file]) => file)).toEqual([first, second, second]);
    const messages = store.getState().chat.messages;
    expect(messages.filter(({ role }) => role === 'user')).toHaveLength(1);
    expect(messages.filter(({ text }) => text === 'Первый файл')).toHaveLength(1);
    expect(messages.filter(({ text }) => text === 'Второй файл')).toHaveLength(1);
  });

  it('preserves successful upload on a manual retry after chat failure', async () => {
    const { api, result, store, id } = setup();
    const file = new File(['data'], 'spec.pdf', { type: 'application/pdf' });
    api.upload.mockResolvedValue({ ...chatFixture, message: 'Файл обработан' });
    api.chat.mockRejectedValueOnce(new Error('Сервис недоступен'));
    act(() => {
      result.current.setDraft('Найди аналог');
      result.current.attach([file]);
    });
    act(() => result.current.send());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(api.chat).toHaveBeenCalledOnce();
    expect(result.current.draft).toBe('Найди аналог');
    act(() => result.current.send());
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(2));
    expect(api.upload).toHaveBeenCalledOnce();
    expect(api.chat).toHaveBeenLastCalledWith(id, 'Найди аналог');
    expect(
      store.getState().chat.messages.filter(({ text }) => text === 'Файл обработан'),
    ).toHaveLength(1);
  });

  it('replaces proposal on every reply but preserves cart when reply.cart is null', async () => {
    const { api, result, store, cache, id } = setup();
    cache.setQueryData(queryKeys.cart(id), cartFixture);
    store.dispatch(setProposal(proposalFixture));
    api.chat.mockResolvedValue({ ...chatFixture, pending_cart_action: null, cart: null });
    act(() => result.current.send('Другой вопрос'));
    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
    await waitFor(() => expect(store.getState().chat.proposal).toBeNull());
    expect(cache.getQueryData(queryKeys.cart(id))).toEqual(cartFixture);
  });

  it('clears expired session data and does not replay the old message into the new session', async () => {
    const { api, result, store, cache, id } = setup();
    cache.setQueryData(queryKeys.cart(id), cartFixture);
    store.dispatch(setProposal(proposalFixture));
    api.chat.mockRejectedValue(new ApiError(404, 'session_not_found', 'Expired'));
    act(() => result.current.send('Старый запрос'));
    await waitFor(() => expect(result.current.session.sessionId).toBe('new-session'));
    expect(api.start).toHaveBeenCalledOnce();
    expect(api.chat).toHaveBeenCalledOnce();
    expect(store.getState().chat.messages).toEqual([]);
    expect(store.getState().chat.proposal).toBeNull();
    expect(cache.getQueryData(queryKeys.cart(id))).toBeUndefined();
    expect(result.current.draft).toBe('');
    expect(result.current.session.notice).toContain('Диалог истёк');
  });

  it('disables uploads after scanner failure while allowing a text retry', async () => {
    const { api, result } = setup();
    api.upload.mockRejectedValue(new ApiError(503, 'upload_scanner_unavailable', 'Unavailable'));
    act(() => {
      result.current.setDraft('Артикул ABC');
      result.current.attach([new File(['data'], 'spec.pdf', { type: 'application/pdf' })]);
    });
    act(() => result.current.send());
    await waitFor(() => expect(result.current.uploadsDisabled).toBe(true));
    expect(result.current.files).toEqual([]);
    expect(result.current.draft).toBe('Артикул ABC');
    act(() => result.current.send());
    await waitFor(() => expect(api.chat).toHaveBeenCalledOnce());
    expect(api.upload).toHaveBeenCalledOnce();
  });
});
