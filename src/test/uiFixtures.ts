import type { Cart, CartProposal, Product } from '../api/types';

export const product: Product = {
  id: 'cable-1',
  name: 'Кабель ВВГнг 3x2.5',
  article: 'ABC-123',
  brand: null,
  category: null,
  description: null,
  price: '850.00',
  quantity: '12.5',
  stores: [],
  attributes: {},
  certificates: [],
  product_url: null,
  source: 'ekt_catalog',
};

export const proposal: CartProposal = {
  operation_id: '3df954a6-0688-4457-87fe-632f19b2f451',
  product_id: product.id,
  product_name: product.name,
  quantity: 2,
  price_at_proposal: '850.00',
  available_quantity: '12.5',
  status: 'WAITING_CONFIRMATION',
  expires_at: '2099-01-01T00:00:00Z',
  requires_confirmation: true,
  demo: true,
};

export const cart: Cart = {
  items: [{ product_id: product.id, product_name: product.name, quantity: 2, price: '850.00' }],
  total_quantity: 2,
  total_amount: '1700.00',
  cart_url: '/api/cart?session_id=example',
  demo: true,
};
