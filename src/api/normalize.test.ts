import { describe, expect, it } from 'vitest';
import {
  normalizeCart,
  normalizeCartResult,
  normalizeChat,
  normalizeHealth,
  normalizeProduct,
  normalizeProposal,
  normalizeSession,
} from './normalize';
import {
  analogFixture,
  cartFixture,
  chatFixture,
  productFixture,
  proposalFixture,
  resultFixture,
  sessionFixture,
} from './fixtures';

describe('documented response validation', () => {
  it('preserves decimal precision, fractional stock and unknown versus zero', () => {
    const product = normalizeProduct({
      ...productFixture,
      price: '9007199254740993.01',
      quantity: '12.5',
    });
    expect(product.price).toBe('9007199254740993.01');
    expect(product.quantity).toBe('12.5');
    expect(normalizeProduct({ ...productFixture, price: null, quantity: null })).toMatchObject({
      price: null,
      quantity: null,
    });
    expect(normalizeProduct({ ...productFixture, price: '0', quantity: '0' })).toMatchObject({
      price: '0',
      quantity: '0',
    });
    expect(normalizeProduct({ ...productFixture, quantity: '0E-10' }).quantity).toBe('0E-10');
  });

  it.each([850, -1, '', 'NaN', '-1', {}, undefined])(
    'rejects invalid decimal prices %j',
    (price) => {
      expect(() => normalizeProduct({ ...productFixture, price })).toThrow('цена');
    },
  );

  it.each([-1, 1.5, undefined, '-1', 'unknown'])(
    'rejects malformed warehouse quantity %j',
    (quantity) => {
      expect(() =>
        normalizeProduct({ ...productFixture, stores: [{ name: 'Склад', quantity }] }),
      ).toThrow('остаток');
    },
  );

  it('accepts nullable fields and empty optional descriptions without fabricating values', () => {
    expect(normalizeProduct({ ...productFixture, description: '' })).toEqual({
      ...productFixture,
      description: '',
    });
    expect(() => normalizeProduct({ ...productFixture, attributes: { voltage: 220 } })).toThrow(
      'voltage',
    );
    expect(() => normalizeProduct({ ...productFixture, source: 'external' })).toThrow('source');
  });

  it.each([
    { requires_confirmation: 'true' },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: 2147483648 },
    { available_quantity: -1 },
    { available_quantity: undefined },
    { product_id: undefined },
    { operation_id: undefined },
    { expires_at: 'not-a-date' },
    { status: 'ADDED' },
  ])('rejects a malformed proposal %j', (invalid) => {
    expect(() => normalizeProposal({ ...proposalFixture, ...invalid })).toThrow('Backend');
  });

  it.each([undefined, 'false', 0, 1, null])('rejects a non-boolean success flag %j', (success) => {
    expect(() => normalizeCartResult({ ...resultFixture, success })).toThrow('success');
  });

  it('validates success and status together, preserving a reconfirmation with no replacement', () => {
    expect(() =>
      normalizeCartResult({ ...resultFixture, status: 'reconfirmation_required' }),
    ).toThrow('success/status');
    const result = {
      ...resultFixture,
      status: 'reconfirmation_required',
      success: false,
      pending_cart_action: null,
    };
    expect(normalizeCartResult(result)).toEqual(result);
  });

  it.each([
    { items: {} },
    { total_amount: undefined },
    { total_amount: -1 },
    { total_quantity: 1.5 },
    { items: [{ ...cartFixture.items[0], quantity: 0 }] },
    { items: [{ ...cartFixture.items[0], price: -1 }] },
    { items: [{ ...cartFixture.items[0], product_name: undefined }] },
  ])('rejects malformed cart contents %j', (invalid) => {
    expect(() => normalizeCart({ ...cartFixture, ...invalid })).toThrow('Backend');
  });

  it('preserves exact server totals, proposal, result and session data', () => {
    expect(normalizeCart(cartFixture)).toEqual(cartFixture);
    expect(normalizeProposal(proposalFixture)).toEqual(proposalFixture);
    expect(normalizeCartResult(resultFixture)).toEqual(resultFixture);
    expect(normalizeSession(sessionFixture)).toEqual(sessionFixture);
    expect(() => normalizeSession({ ...sessionFixture, session_token: undefined })).toThrow(
      'session_token',
    );
  });

  it('preserves cart:null and decodes server HTML escaping exactly once as plain text', () => {
    const result = normalizeChat({
      ...chatFixture,
      message: 'A &amp; B &lt;script&gt; &#x27; &#39; &quot; &amp;lt;',
    });
    expect(result.message).toBe("A & B <script> ' ' \" &lt;");
    expect(result.cart).toBeNull();
    expect(result.pending_cart_action).toBeNull();
    expect(normalizeChat({ ...chatFixture, cart: cartFixture }).cart).toEqual(cartFixture);
  });

  it('validates catalog analogs and preserves differences and unknown parameters', () => {
    const reply = normalizeChat({ ...chatFixture, analogs: [analogFixture] });
    expect(reply.analogs).toEqual([analogFixture]);
    expect(() =>
      normalizeChat({ ...chatFixture, analogs: [{ ...analogFixture, score: 1.1 }] }),
    ).toThrow('score');
    expect(() =>
      normalizeChat({ ...chatFixture, analogs: [{ ...analogFixture, product: null }] }),
    ).toThrow('товар');
  });

  it('validates external candidates and low-confidence extracted fields independently', () => {
    const external = {
      kind: 'external_variant',
      name: 'Вариант',
      url: 'https://example.com',
      attributes: [],
      differences: ['Тип'],
      unknown: ['Размер'],
      recommendation: 'requires_review',
    };
    const extracted = {
      article: '123',
      barcode: null,
      brand: null,
      model: null,
      category: null,
      attributes: [{ name: 'Тип', value: 'A' }],
      quantity: null,
      unreadable_fields: ['Размер'],
      confidence: 0.3,
    };
    expect(
      normalizeChat({ ...chatFixture, external_variants: [external], extracted: [extracted] }),
    ).toMatchObject({ external_variants: [external], extracted: [extracted] });
    expect(() =>
      normalizeChat({ ...chatFixture, extracted: [{ ...extracted, confidence: 'high' }] }),
    ).toThrow('confidence');
    expect(() =>
      normalizeChat({
        ...chatFixture,
        external_variants: [{ ...external, recommendation: 'possible_alternative' }],
      }),
    ).toThrow('recommendation');
  });

  it('validates nested response fields and supports liveness and readiness', () => {
    expect(() =>
      normalizeChat({ ...chatFixture, products: [{ ...productFixture, price: -1 }] }),
    ).toThrow('цена');
    expect(() => normalizeChat({ ...chatFixture, cart_changed: 'false' })).toThrow('cart_changed');
    expect(normalizeHealth({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(normalizeHealth({ status: 'ok', redis: 'ok' })).toEqual({ status: 'ok', redis: 'ok' });
    expect(() => normalizeHealth({ status: 'ok', redis: true })).toThrow('redis');
  });
});
