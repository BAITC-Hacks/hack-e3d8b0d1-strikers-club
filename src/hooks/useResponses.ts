import { useQueryClient } from '@tanstack/react-query';
import type { CartResult, ChatReply } from '../api/types';
import { queryKeys } from '../api/queryKeys';
import { useAppDispatch, useAppStore } from '../state/hooks';
import { addMessage, setProposal } from '../state/store';

export function useResponses() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const cache = useQueryClient();
  return (id: string, reply: ChatReply | CartResult) => {
    if (id !== store.getState().chat.sessionId) return;
    dispatch(setProposal(reply.pending_cart_action));
    if (reply.cart) cache.setQueryData(queryKeys.cart(id), reply.cart);
    const isChat = 'products' in reply;
    dispatch(
      addMessage({
        role: 'assistant',
        text: reply.message,
        products: isChat ? reply.products : undefined,
        analogs: isChat ? reply.analogs : undefined,
        external_variants: isChat ? reply.external_variants : undefined,
        extracted: isChat ? reply.extracted : undefined,
        cartLink: isChat ? reply.cart_changed : reply.status === 'added' && reply.success,
      }),
    );
  };
}
