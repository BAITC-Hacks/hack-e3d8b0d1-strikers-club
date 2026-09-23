import type { Analog, Cart, CartProposal, CartResult, ChatReply, Product } from './types';

export const sessionFixture = {
  session_id: '41333b62-41bd-4fcf-8d98-4954f4bf291a',
  session_token: 'test-session-token',
  expires_in: 3600,
};
export const productFixture: Product = {
  id: '515291',
  name: 'Кабель',
  article: 'EXAMPLE-001',
  brand: null,
  category: null,
  description: null,
  price: '850.00',
  quantity: '12.5',
  stores: [{ name: 'Склад', quantity: '12.5' }],
  attributes: { Сечение: '2.5' },
  certificates: [{ name: null, url: 'https://example.com/certificate.pdf' }],
  product_url: null,
  source: 'ekt_catalog',
};
export const proposalFixture: CartProposal = {
  operation_id: 'ab8f3a9a-e95b-4b4a-a9a5-d03289445e2e',
  product_id: productFixture.id,
  product_name: productFixture.name,
  quantity: 2,
  price_at_proposal: '850.00',
  available_quantity: '12.5',
  status: 'WAITING_CONFIRMATION',
  expires_at: '2030-01-01T12:10:00Z',
  requires_confirmation: true,
  demo: true,
};
export const cartFixture: Cart = {
  items: [
    {
      product_id: productFixture.id,
      product_name: productFixture.name,
      quantity: 2,
      price: '850.00',
    },
  ],
  total_quantity: 2,
  total_amount: '1700.00',
  cart_url: '/api/cart?session_id=example',
  demo: true,
};
export const resultFixture: CartResult = {
  operation_id: proposalFixture.operation_id,
  product_id: productFixture.id,
  quantity: 2,
  status: 'added',
  message: 'Добавлено',
  cart: cartFixture,
  pending_cart_action: null,
  demo: true,
  success: true,
  cart_url: cartFixture.cart_url,
};
export const chatFixture: ChatReply = {
  session_id: sessionFixture.session_id,
  message: 'Товар найден',
  cart_changed: false,
  pending_cart_action: null,
  products: [productFixture],
  analogs: [],
  external_variants: [],
  extracted: [],
  cart: null,
  cart_url: null,
  demo_cart: true,
};
export const analogFixture: Analog = {
  kind: 'catalog_analog',
  product_id: productFixture.id,
  product: productFixture,
  score: 0.8,
  match: ['Напряжение'],
  differences: ['Производитель'],
  unknown: ['Размер'],
  quantity: '12.5',
  recommendation: 'requires_review',
};
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
