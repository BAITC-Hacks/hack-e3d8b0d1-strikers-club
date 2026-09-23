import type { Cart, CartProposal, CartResult, Product } from './types';
import { availableWholeUnits } from '../lib/format';

/** Synthetic cart only. The live application always uses backend totals. */
export function createDemoCart(sessionId: string) {
  const cart: Cart = {
    items: [],
    total_quantity: 0,
    total_amount: '0',
    cart_url: '/api/cart?session_id=' + sessionId,
    demo: true,
  };
  let pending: CartProposal | null = null;
  const completed = new Map<string, CartResult>();
  function prepare(product: Product, quantity: number) {
    pending = null;
    const reserved = cart.items.find((item) => item.product_id === product.id)?.quantity ?? 0;
    const available = availableWholeUnits(product.quantity) - reserved;
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > available ||
      product.price === null
    )
      throw new Error('Недостаточно товара в демонстрационном каталоге.');
    pending = {
      operation_id: crypto.randomUUID(),
      product_id: product.id,
      product_name: product.name,
      quantity,
      price_at_proposal: product.price,
      available_quantity: String(available),
      status: 'WAITING_CONFIRMATION',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      requires_confirmation: true,
      demo: true,
    };
    return pending;
  }
  function confirm(proposal: CartProposal): CartResult {
    const previous = completed.get(proposal.operation_id);
    if (
      previous &&
      previous.product_id === proposal.product_id &&
      previous.quantity === proposal.quantity
    )
      return structuredClone({ ...previous, cart, cart_url: cart.cart_url });
    if (
      !pending ||
      pending.operation_id !== proposal.operation_id ||
      pending.product_id !== proposal.product_id ||
      pending.quantity !== proposal.quantity ||
      Date.parse(pending.expires_at) <= Date.now()
    )
      throw new Error('Предложение изменилось или истекло. Выберите товар снова.');
    const item = cart.items.find((line) => line.product_id === pending!.product_id);
    if (item) {
      item.quantity += pending.quantity;
      item.price = pending.price_at_proposal;
    } else
      cart.items.push({
        product_id: pending.product_id,
        product_name: pending.product_name,
        quantity: pending.quantity,
        price: pending.price_at_proposal,
      });
    cart.total_quantity = cart.items.reduce((sum, line) => sum + line.quantity, 0);
    // Demo fixture prices are whole integers; BigInt keeps even large totals exact.
    cart.total_amount = cart.items
      .reduce((sum, line) => sum + BigInt(line.price) * BigInt(line.quantity), 0n)
      .toString();
    const result: CartResult = {
      operation_id: pending.operation_id,
      product_id: pending.product_id,
      quantity: pending.quantity,
      status: 'added',
      success: true,
      demo: true,
      message: 'Товар добавлен в демонстрационную корзину.',
      cart: structuredClone(cart),
      cart_url: cart.cart_url,
      pending_cart_action: null,
    };
    pending = null;
    completed.set(result.operation_id, result);
    return structuredClone(result);
  }
  return {
    cart,
    prepare,
    confirm,
    cancel: () => {
      pending = null;
    },
  };
}
