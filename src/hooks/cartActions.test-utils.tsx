import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { afterEach, vi } from 'vitest';
import type { AssistantApi, CartResult, ChatReply } from '../api/types';
import { createAssistantStore, sessionStarted } from '../state/store';
import { product, proposal, cart } from '../test/uiFixtures';
import { useCartActions } from './useCartActions';
import { useSession } from './useSession';

export { product, proposal, cart };
export function chatReply(changes: Partial<ChatReply> = {}): ChatReply {
  return {
    session_id: 'session-1',
    message: 'Ответ сервера',
    cart_changed: false,
    pending_cart_action: null,
    products: [],
    analogs: [],
    external_variants: [],
    extracted: [],
    cart: null,
    cart_url: null,
    demo_cart: true,
    ...changes,
  };
}
export function confirmationReply(changes: Partial<CartResult> = {}): CartResult {
  return {
    operation_id: proposal.operation_id,
    product_id: proposal.product_id,
    quantity: proposal.quantity,
    status: 'added',
    success: true,
    message: 'Добавлено',
    cart,
    pending_cart_action: null,
    demo: true,
    cart_url: cart.cart_url,
    ...changes,
  };
}
export function createApi() {
  return {
    mode: 'live' as const,
    start: vi
      .fn<AssistantApi['start']>()
      .mockResolvedValue({ session_id: 'session-2', expires_in: 3600 }),
    chat: vi
      .fn<AssistantApi['chat']>()
      .mockResolvedValue(chatReply({ pending_cart_action: proposal })),
    upload: vi.fn<AssistantApi['upload']>(),
    product: vi.fn<AssistantApi['product']>().mockResolvedValue(product),
    confirm: vi.fn<AssistantApi['confirm']>().mockResolvedValue(confirmationReply()),
    cart: vi.fn<AssistantApi['cart']>().mockResolvedValue(cart),
    health: vi.fn<AssistantApi['health']>(),
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
export function renderCart(api = createApi()) {
  const store = createAssistantStore();
  store.dispatch(sessionStarted('session-1'));
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: 3, retryDelay: 0 },
    },
  });
  clients.push(cache);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    </Provider>
  );
  const view = renderHook(
    () => {
      const session = useSession(api);
      return { ...useCartActions(api, session), session };
    },
    { wrapper },
  );
  return { ...view, api, cache, store };
}
export async function prepareCart(view: ReturnType<typeof renderCart>, quantity = 2) {
  act(() => view.result.current.prepare(product, quantity));
  await waitFor(() => {
    if (!view.result.current.proposal || view.result.current.pending)
      throw new Error('Proposal not ready');
  });
}
