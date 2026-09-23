import type { Cart, CartProposal, CartResult } from './types';
import {
  array,
  boolean,
  decimal,
  decodeMessage,
  invalid,
  literal,
  object,
  quantity,
  text,
} from './validation';

export function normalizeProposal(value: unknown): CartProposal {
  const item = object(value, 'предложение корзины');
  const expiresAt = text(item.expires_at, 'expires_at');
  if (!Number.isFinite(Date.parse(expiresAt))) return invalid('expires_at');
  return {
    operation_id: text(item.operation_id, 'operation_id'),
    product_id: text(item.product_id, 'product_id'),
    product_name: text(item.product_name, 'product_name'),
    quantity: quantity(item.quantity, 'количество товара', 1, 2147483647),
    price_at_proposal: decimal(item.price_at_proposal, 'цена предложения'),
    available_quantity: decimal(item.available_quantity, 'доступный остаток'),
    status: literal(item.status, 'WAITING_CONFIRMATION', 'status'),
    expires_at: expiresAt,
    requires_confirmation: literal(item.requires_confirmation, true, 'requires_confirmation'),
    demo: literal(item.demo, true, 'demo'),
  };
}

export function normalizeCart(value: unknown): Cart {
  const cart = object(value, 'корзина');
  return {
    items: array(cart.items, 'товары корзины').map((entry) => {
      const item = object(entry, 'товар корзины');
      return {
        product_id: text(item.product_id, 'product_id'),
        product_name: text(item.product_name, 'название товара'),
        quantity: quantity(item.quantity, 'количество товара', 1),
        price: decimal(item.price, 'цена товара'),
      };
    }),
    total_quantity: quantity(cart.total_quantity, 'количество товаров в корзине'),
    total_amount: decimal(cart.total_amount, 'сумма корзины'),
    cart_url: text(cart.cart_url, 'cart_url'),
    demo: literal(cart.demo, true, 'demo'),
  };
}

export function normalizeCartResult(value: unknown): CartResult {
  const result = object(value, 'результат добавления в корзину');
  const status = result.status;
  if (status !== 'added' && status !== 'reconfirmation_required') return invalid('status');
  const success = boolean(result.success, 'success');
  if (success !== (status === 'added')) return invalid('success/status');
  return {
    operation_id: text(result.operation_id, 'operation_id'),
    product_id: text(result.product_id, 'product_id'),
    quantity: quantity(result.quantity, 'количество товара', 1, 2147483647),
    status,
    success,
    message: decodeMessage(result.message),
    cart: normalizeCart(result.cart),
    pending_cart_action:
      result.pending_cart_action === null ? null : normalizeProposal(result.pending_cart_action),
    demo: literal(result.demo, true, 'demo'),
    cart_url: text(result.cart_url, 'cart_url'),
  };
}
