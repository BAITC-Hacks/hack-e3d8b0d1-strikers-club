import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { queryKeys } from '../api/queryKeys';
import type { CartResult, ChatReply } from '../api/types';
import { newConversation, sessionStarted, setProposal } from '../state/store';
import {
  cart,
  chatReply,
  confirmationReply,
  createApi,
  deferred,
  prepareCart,
  product,
  proposal,
  renderCart,
} from './cartActions.test-utils';

describe('cart request lifecycle', () => {
  it('blocks same-tick duplicate actions and every competing operation while a turn runs', async () => {
    const api = createApi();
    const preparing = deferred<ChatReply>();
    const confirming = deferred<CartResult>();
    api.chat.mockReturnValue(preparing.promise);
    api.confirm.mockReturnValue(confirming.promise);
    const view = renderCart(api);
    act(() => {
      view.result.current.prepare(product, 2);
      view.result.current.prepare(product, 3);
      view.result.current.refresh();
    });
    await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1));
    expect(api.cart).not.toHaveBeenCalled();
    expect(view.store.getState().chat.messages).toHaveLength(1);
    await act(async () => preparing.resolve(chatReply({ pending_cart_action: proposal })));
    await waitFor(() => expect(view.result.current.proposal).toEqual(proposal));
    act(() => {
      view.result.current.confirm();
      view.result.current.confirm();
      view.result.current.cancel();
      view.result.current.prepare(product, 1);
      view.result.current.refresh();
    });
    await waitFor(() => expect(api.confirm).toHaveBeenCalledExactlyOnceWith('session-1', proposal));
    expect(api.chat).toHaveBeenCalledTimes(1);
    expect(api.cart).not.toHaveBeenCalled();
    await act(async () => confirming.resolve(confirmationReply()));
    await waitFor(() => expect(view.result.current.proposal).toBeNull());
    expect(view.result.current.error).toBe('');
  });

  it('recovers an expired session and clears the old cart, proposal and history', async () => {
    const view = renderCart();
    await prepareCart(view);
    act(() => view.cache.setQueryData(queryKeys.cart('session-1'), cart));
    view.api.confirm.mockRejectedValue(new ApiError(404, 'session_not_found', 'Expired'));
    act(() => view.result.current.confirm());
    await waitFor(() => expect(view.result.current.session.sessionId).toBe('session-2'));
    expect(view.api.start).toHaveBeenCalledTimes(1);
    expect(view.result.current.proposal).toBeNull();
    expect(view.cache.getQueryData(queryKeys.cart('session-1'))).toBeUndefined();
    expect(view.store.getState().chat.messages).toHaveLength(0);
    expect(view.result.current.session.notice).toContain('Диалог истёк');
    expect(view.api.confirm).toHaveBeenCalledTimes(1);
  });

  it('ignores a late success after the active session has changed', async () => {
    const api = createApi();
    const pending = deferred<CartResult>();
    api.confirm.mockReturnValue(pending.promise);
    const view = renderCart(api);
    await prepareCart(view);
    act(() => view.result.current.confirm());
    await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(1));
    act(() => {
      view.store.dispatch(newConversation());
      view.store.dispatch(sessionStarted('session-2'));
      view.store.dispatch(setProposal({ ...proposal, operation_id: 'current-operation' }));
    });
    await act(async () => pending.resolve(confirmationReply()));
    expect(view.store.getState().chat.messages).toHaveLength(0);
    expect(view.result.current.proposal?.operation_id).toBe('current-operation');
    expect(view.cache.getQueryData(queryKeys.cart('session-2'))).toBeUndefined();
  });

  it('does not use an old confirmation callback after a new session starts', async () => {
    const view = renderCart();
    await prepareCart(view);
    const oldConfirm = view.result.current.confirm;
    await act(async () => view.result.current.session.start(true));
    expect(view.result.current.session.sessionId).toBe('session-2');
    await act(async () => oldConfirm());
    expect(view.api.confirm).not.toHaveBeenCalled();
    expect(view.result.current.proposal).toBeNull();
  });

  it('never confirms an obsolete proposal after another response replaced it', async () => {
    const view = renderCart();
    await prepareCart(view);
    const oldConfirm = view.result.current.confirm;
    const replacement = { ...proposal, operation_id: 'replacement-operation' };
    act(() => view.store.dispatch(setProposal(replacement)));
    await act(async () => oldConfirm());
    expect(view.api.confirm).not.toHaveBeenCalled();
    act(() => view.result.current.confirm());
    await waitFor(() =>
      expect(view.api.confirm).toHaveBeenCalledExactlyOnceWith('session-1', replacement),
    );
  });
});
