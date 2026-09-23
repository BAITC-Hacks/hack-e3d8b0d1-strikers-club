import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { ApiError } from '../api/errors';
import type { AssistantApi, CartProposal, Product } from '../api/types';
import { availableWholeUnits } from '../lib/format';
import { errorMessage } from '../lib/errorMessage';
import { useAppDispatch, useAppSelector, useAppStore } from '../state/hooks';
import { addMessage, markProductUnavailable, setProposal } from '../state/store';
import type { SessionController } from './useSession';
import { useResponses } from './useResponses';

type Action =
  { kind: 'chat'; text: string; productId?: string } | { kind: 'confirm'; proposal: CartProposal };
type Request = Action & { sessionId: string };

export function useCartActions(api: AssistantApi, session: SessionController) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const apply = useResponses();
  const proposal = useAppSelector((state) => state.chat.proposal);
  const [error, setError] = useState('');
  const acting = useRef(false);
  const cart = useQuery({
    queryKey: queryKeys.cart(session.sessionId),
    queryFn: () => session.run((id) => api.cart(id)),
    enabled: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: (action: Request) =>
      session.run(async (id) => {
        if (id !== action.sessionId) return;
        const result =
          action.kind === 'chat'
            ? await api.chat(id, action.text)
            : await api.confirm(id, action.proposal);
        apply(id, result);
      }),
    onError: (error, action) => {
      if (!session.isCurrent(action.sessionId)) return;
      // A lost confirmation response can be repeated with the SAME operation_id.
      // Keep its proposal unless the server explicitly invalidates it.
      if (error instanceof ApiError && error.code === 'cart_conflict') dispatch(setProposal(null));
      if (error instanceof ApiError && error.code === 'product_not_found') {
        const productId = action.kind === 'confirm' ? action.proposal.product_id : action.productId;
        if (productId) dispatch(markProductUnavailable(productId));
        dispatch(setProposal(null));
      }
      setError(errorMessage(error));
    },
    onSettled: () => {
      acting.current = false;
    },
  });

  function act(action: Action) {
    if (
      !session.ready ||
      session.pending ||
      acting.current ||
      !session.isCurrent(session.sessionId)
    )
      return;
    acting.current = true;
    setError('');
    if (action.kind === 'chat') dispatch(addMessage({ role: 'user', text: action.text }));
    mutation.mutate({ ...action, sessionId: session.sessionId });
  }
  function prepare(product: Product, quantity: number) {
    if (store.getState().chat.unavailableProducts.includes(product.id)) return;
    const limit = availableWholeUnits(product.quantity);
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 2147483647 ||
      quantity > limit
    ) {
      setError('Укажите целое количество в пределах доступного остатка.');
      return;
    }
    act({
      kind: 'chat',
      text: `Добавь ${quantity} единиц товара с ID "${product.id}" в корзину.`,
      productId: product.id,
    });
  }
  function confirm() {
    if (!proposal || store.getState().chat.proposal !== proposal) return;
    if (Date.parse(proposal.expires_at) <= Date.now()) {
      setError('Предложение истекло. Выберите товар ещё раз.');
      dispatch(setProposal(null));
      return;
    }
    act({ kind: 'confirm', proposal: { ...proposal } });
  }
  function refresh() {
    if (session.ready && !session.pending && !acting.current && !cart.isFetching)
      void cart.refetch();
  }

  return {
    cart,
    proposal,
    error,
    prepare,
    confirm,
    refresh,
    clearError: () => setError(''),
    reset: () => {
      setError('');
      mutation.reset();
    },
    cancel: () => {
      if (store.getState().chat.proposal === proposal) act({ kind: 'chat', text: 'отмена' });
    },
    confirming: mutation.isPending,
    pending: mutation.isPending,
    count: cart.data?.total_quantity ?? 0,
  };
}
