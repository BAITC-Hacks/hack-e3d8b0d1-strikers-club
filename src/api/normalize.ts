import type { ChatReply, SessionInfo } from './types';
import { normalizeCart, normalizeProposal } from './normalizeCart';
import {
  normalizeAnalog,
  normalizeExternalVariant,
  normalizeIdentifiedProduct,
  normalizeProduct,
} from './normalizeProducts';
import {
  array,
  boolean,
  decodeMessage,
  literal,
  nullableText,
  object,
  quantity,
  text,
} from './validation';

export { normalizeCart, normalizeCartResult, normalizeProposal } from './normalizeCart';
export { normalizeProduct } from './normalizeProducts';

export function normalizeSession(value: unknown): SessionInfo & { session_token: string } {
  const session = object(value, 'сессия');
  return {
    session_id: text(session.session_id, 'session_id'),
    session_token: text(session.session_token, 'session_token'),
    expires_in: quantity(session.expires_in, 'expires_in', 1),
  };
}

export function normalizeChat(value: unknown): ChatReply {
  const reply = object(value, 'ответ чата');
  return {
    session_id: text(reply.session_id, 'session_id'),
    message: decodeMessage(reply.message),
    cart_changed: boolean(reply.cart_changed, 'cart_changed'),
    pending_cart_action:
      reply.pending_cart_action === null ? null : normalizeProposal(reply.pending_cart_action),
    products: array(reply.products, 'products').map(normalizeProduct),
    analogs: array(reply.analogs, 'analogs').map(normalizeAnalog),
    external_variants: array(reply.external_variants, 'external_variants').map(
      normalizeExternalVariant,
    ),
    extracted: array(reply.extracted, 'extracted').map(normalizeIdentifiedProduct),
    cart: reply.cart === null ? null : normalizeCart(reply.cart),
    cart_url: nullableText(reply.cart_url, 'cart_url'),
    demo_cart: literal(reply.demo_cart, true, 'demo_cart'),
  };
}

export const normalizeUpload = normalizeChat;

export function normalizeHealth(value: unknown) {
  const health = object(value, 'статус сервера');
  return {
    status: text(health.status, 'status'),
    ...(health.redis === undefined ? {} : { redis: text(health.redis, 'redis') }),
  };
}
