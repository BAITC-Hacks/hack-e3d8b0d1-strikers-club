import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { queryKeys } from '../api/queryKeys';
import { setProposal } from '../state/store';
import {
  cart,
  chatReply,
  confirmationReply,
  createApi,
  prepareCart,
  product,
  proposal,
  renderCart,
} from './cartActions.test-utils';

describe('server-driven cart actions', () => {
  it('does not fetch cart initially or from background cache invalidation', async () => {
    const view = renderCart();
    await act(async () => {
      await view.cache.invalidateQueries({ queryKey: queryKeys.cart('session-1') });
      await view.cache.refetchQueries({ queryKey: queryKeys.cart('session-1') });
    });
    expect(view.api.cart).not.toHaveBeenCalled();
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.cart.data).toEqual(cart));
    expect(view.api.cart).toHaveBeenCalledExactlyOnceWith('session-1');
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, 13])(
    'rejects quantity %s before sending a message',
    (quantity) => {
      const view = renderCart();
      act(() => view.result.current.prepare(product, quantity));
      expect(view.api.chat).not.toHaveBeenCalled();
      expect(view.api.confirm).not.toHaveBeenCalled();
      expect(view.result.current.error).toMatch(/целое количество/);
    },
  );

  it('requests a proposal through chat and accepts the server-adjusted offer unchanged', async () => {
    const api = createApi();
    const adjusted = { ...proposal, quantity: 1, price_at_proposal: '900.01' };
    api.chat.mockResolvedValue(chatReply({ pending_cart_action: adjusted }));
    const view = renderCart(api);
    await prepareCart(view, 2);
    expect(api.chat).toHaveBeenCalledExactlyOnceWith(
      'session-1',
      'Добавь 2 единиц товара с ID "cable-1" в корзину.',
    );
    expect(view.result.current.proposal).toEqual(adjusted);
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.cart).not.toHaveBeenCalled();
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.proposal).toBeNull());
    expect(api.confirm).toHaveBeenCalledExactlyOnceWith('session-1', adjusted);
    expect(view.cache.getQueryData(queryKeys.cart('session-1'))).toEqual(cart);
  });

  it('preserves the current cart when the next reply has cart: null', async () => {
    const view = renderCart();
    act(() => view.cache.setQueryData(queryKeys.cart('session-1'), cart));
    await prepareCart(view);
    expect(view.cache.getQueryData(queryKeys.cart('session-1'))).toEqual(cart);
    expect(view.api.cart).not.toHaveBeenCalled();
  });

  it('cancels through chat and keeps the already added cart', async () => {
    const view = renderCart();
    await prepareCart(view);
    act(() => view.cache.setQueryData(queryKeys.cart('session-1'), cart));
    view.api.chat.mockResolvedValue(chatReply());
    act(() => view.result.current.cancel());
    await waitFor(() => expect(view.result.current.proposal).toBeNull());
    expect(view.api.chat).toHaveBeenLastCalledWith('session-1', 'отмена');
    expect(view.store.getState().chat.messages.some((message) => message.text === 'отмена')).toBe(
      true,
    );
    expect(view.cache.getQueryData(queryKeys.cart('session-1'))).toEqual(cart);
  });

  it('keeps an uncertain confirmation and retries precisely the same operation only on another click', async () => {
    const api = createApi();
    api.confirm.mockRejectedValueOnce(new Error('Связь потеряна'));
    const view = renderCart(api);
    await prepareCart(view);
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.error).toBe('Связь потеряна'));
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(view.result.current.proposal).toEqual(proposal);
    expect(api.cart).not.toHaveBeenCalled();
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.proposal).toBeNull());
    expect(api.confirm).toHaveBeenCalledTimes(2);
    expect(api.confirm.mock.calls[1]).toEqual(api.confirm.mock.calls[0]);
  });

  it('requires a fresh click for reconfirmation even after HTTP success', async () => {
    const api = createApi();
    const updated = { ...proposal, operation_id: 'new-operation', price_at_proposal: '950.00' };
    api.confirm.mockResolvedValueOnce(
      confirmationReply({
        status: 'reconfirmation_required',
        success: false,
        message: 'Цена изменилась',
        pending_cart_action: updated,
      }),
    );
    const view = renderCart(api);
    await prepareCart(view);
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.proposal).toEqual(updated));
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(view.store.getState().chat.messages.at(-1)).toMatchObject({
      text: 'Цена изменилась',
      cartLink: false,
    });
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.proposal).toBeNull());
    expect(api.confirm).toHaveBeenLastCalledWith('session-1', updated);
  });

  it('invalidates an expired proposal locally and a conflicting proposal from the server', async () => {
    const view = renderCart();
    act(() =>
      view.store.dispatch(setProposal({ ...proposal, expires_at: '2000-01-01T00:00:00Z' })),
    );
    act(() => view.result.current.confirm());
    expect(view.api.confirm).not.toHaveBeenCalled();
    expect(view.result.current.proposal).toBeNull();
    await prepareCart(view);
    view.api.confirm.mockRejectedValue(new ApiError(409, 'cart_conflict', 'Conflict'));
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.proposal).toBeNull());
    expect(view.api.start).not.toHaveBeenCalled();
  });
});
