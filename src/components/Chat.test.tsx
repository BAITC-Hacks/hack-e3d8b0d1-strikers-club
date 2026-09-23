import '@testing-library/jest-dom/vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartResult } from '../api/types';
import { cart, product, proposal } from '../test/uiFixtures';
import { clearChatClients, deferred, mockApi, renderChat, sessionId } from '../test/chatHarness';

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  clearChatClients();
});

describe('backend cart workflow', () => {
  it('creates a session, requests a proposal through chat, cancels on the server and confirms the exact proposal', async () => {
    const api = mockApi();
    const confirmation = deferred<CartResult>();
    api.confirm.mockReturnValue(confirmation.promise);
    await renderChat(api, true);
    expect(api.start).toHaveBeenCalledOnce();
    expect(api.cart).not.toHaveBeenCalled();
    const user = userEvent.setup();
    const quantity = screen.getByRole('textbox', { name: `Количество: ${product.name}` });
    await user.clear(quantity);
    await user.type(quantity, '2');
    await user.click(screen.getByRole('button', { name: 'В корзину' }));
    let dialog = await screen.findByRole('dialog', { name: 'Добавить в корзину?' });
    expect(api.chat).toHaveBeenLastCalledWith(
      sessionId,
      `Добавь 2 единиц товара с ID "${product.id}" в корзину.`,
    );
    expect(api.confirm).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.chat).toHaveBeenLastCalledWith(sessionId, 'отмена');
    expect(api.confirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'В корзину' }));
    dialog = await screen.findByRole('dialog', { name: 'Добавить в корзину?' });
    const confirm = within(dialog).getByRole('button', { name: 'Да, добавить' });
    await user.dblClick(confirm);
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith(sessionId, proposal);
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeDisabled();
    await act(async () =>
      confirmation.resolve({
        operation_id: proposal.operation_id,
        product_id: product.id,
        quantity: 2,
        status: 'added',
        success: true,
        message: 'Товар добавлен в корзину.',
        cart,
        pending_cart_action: null,
        demo: true,
        cart_url: cart.cart_url,
      }),
    );
    expect(await screen.findByText('Товар добавлен в корзину.')).toBeInTheDocument();
    expect(api.cart).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Открыть корзину/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Открыть корзину/ }));
    expect(await screen.findByRole('dialog', { name: /Корзина/ })).toBeInTheDocument();
    expect(api.cart).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(screen.getByText(/Заказ и резерв на ekt.kz не создаются/)).toBeInTheDocument();
  });

  it('requires another explicit click after server reconfirmation despite HTTP success', async () => {
    const api = mockApi();
    const updated = {
      ...proposal,
      operation_id: 'new-operation',
      price_at_proposal: '975.25',
      quantity: 1,
    };
    api.confirm.mockResolvedValueOnce({
      operation_id: proposal.operation_id,
      product_id: product.id,
      quantity: proposal.quantity,
      status: 'reconfirmation_required',
      success: false,
      message: 'Цена изменилась. Подтвердите новые условия.',
      cart: { ...cart, items: [], total_quantity: 0, total_amount: '0' },
      pending_cart_action: updated,
      demo: true,
      cart_url: cart.cart_url,
    });
    await renderChat(api, true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'В корзину' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить в корзину?' });
    await user.click(within(dialog).getByRole('button', { name: 'Да, добавить' }));
    expect(await within(dialog).findByText('975,25')).toBeInTheDocument();
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Открыть корзину/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Да, добавить' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(2));
    expect(api.confirm).toHaveBeenLastCalledWith(sessionId, updated);
  });

  it('shows a lost confirmation response inside the dialog and retries the same operation only on click', async () => {
    const api = mockApi();
    api.confirm.mockRejectedValueOnce(new Error('Ответ не получен. Повторите подтверждение.'));
    await renderChat(api, true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'В корзину' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить в корзину?' });
    await user.click(within(dialog).getByRole('button', { name: 'Да, добавить' }));
    expect(
      await within(dialog).findByText('Ответ не получен. Повторите подтверждение.'),
    ).toBeInTheDocument();
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith(sessionId, proposal);
    await user.click(within(dialog).getByRole('button', { name: 'Да, добавить' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(2));
    expect(api.confirm.mock.calls[1]).toEqual(api.confirm.mock.calls[0]);
  });
});
