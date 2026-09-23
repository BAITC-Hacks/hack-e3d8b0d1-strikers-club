import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import { expect, vi } from 'vitest';
import type { AssistantApi, ChatReply } from '../api/types';
import { addMessage, createAssistantStore } from '../state/store';
import { Chat } from '../components/Chat';
import { cart, product, proposal } from './uiFixtures';

export const sessionId = '41333b62-41bd-4fcf-8d98-4954f4bf291a';
const clients: QueryClient[] = [];

export function reply(overrides: Partial<ChatReply> = {}): ChatReply {
  return {
    session_id: sessionId,
    message: 'Ответ на вопрос',
    products: [],
    analogs: [],
    external_variants: [],
    extracted: [],
    cart_changed: false,
    pending_cart_action: null,
    cart: null,
    cart_url: null,
    demo_cart: true,
    ...overrides,
  };
}

export function mockApi() {
  return {
    mode: 'live' as const,
    start: vi
      .fn<AssistantApi['start']>()
      .mockResolvedValue({ session_id: sessionId, expires_in: 3600 }),
    chat: vi
      .fn<AssistantApi['chat']>()
      .mockImplementation(async (_id, text) =>
        text === 'отмена'
          ? reply({ message: 'Предложение отменено' })
          : text.startsWith('Добавь')
            ? reply({ message: 'Подтвердите добавление', pending_cart_action: proposal })
            : reply(),
      ),
    upload: vi.fn<AssistantApi['upload']>().mockResolvedValue(reply({ message: 'Файл распознан' })),
    product: vi.fn<AssistantApi['product']>().mockResolvedValue(product),
    confirm: vi.fn<AssistantApi['confirm']>().mockResolvedValue({
      operation_id: proposal.operation_id,
      product_id: product.id,
      quantity: proposal.quantity,
      status: 'added',
      success: true,
      message: 'Товар добавлен в корзину.',
      cart,
      pending_cart_action: null,
      demo: true,
      cart_url: cart.cart_url,
    }),
    cart: vi.fn<AssistantApi['cart']>().mockResolvedValue(cart),
    health: vi.fn<AssistantApi['health']>().mockResolvedValue({ status: 'ok', redis: 'ok' }),
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function renderChat(api: AssistantApi, withProduct = false) {
  const store = createAssistantStore();
  if (withProduct)
    store.dispatch(
      addMessage({ role: 'assistant', text: 'Нашёл нужный кабель.', products: [product] }),
    );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(cache);
  const view = render(
    <Provider store={store}>
      <QueryClientProvider client={cache}>
        <Chat api={api} initiallyOpen />
      </QueryClientProvider>
    </Provider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Корзина, 0 товаров' })).toBeEnabled(),
  );
  return { ...view, store };
}

export function clearChatClients() {
  clients.splice(0).forEach((client) => client.clear());
}
