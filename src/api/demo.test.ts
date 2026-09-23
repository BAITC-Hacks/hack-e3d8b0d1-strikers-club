import { describe, expect, it } from 'vitest';
import { createDemoApi } from './demo';

describe('explicit offline demo', () => {
  it('uses sessions, server-shaped proposals and idempotent confirmation', async () => {
    const api = createDemoApi();
    const { session_id: id } = await api.start();
    const response = await api.chat(id, 'Добавь 2 единиц товара с ID "515291" в корзину.');
    const proposal = response.pending_cart_action!;
    expect(proposal.operation_id).toBeTruthy();
    expect((await api.cart(id)).items).toEqual([]);
    const added = await api.confirm(id, proposal);
    expect(added.cart.total_amount).toBe('1700');
    expect(await api.confirm(id, proposal)).toEqual(added);
    expect((await api.cart(id)).total_quantity).toBe(2);
  });
  it('cancels proposals via chat and replaces session cart on restart', async () => {
    const api = createDemoApi();
    const { session_id: id } = await api.start();
    const response = await api.chat(id, 'Добавь 1 единиц товара с ID "515291" в корзину.');
    await api.chat(id, 'отмена');
    await expect(api.confirm(id, response.pending_cart_action!)).rejects.toThrow('Предложение');
    const next = await api.start();
    expect(next.session_id).not.toBe(id);
    await expect(api.cart(id)).rejects.toThrow('завершён');
    expect((await api.cart(next.session_id)).total_amount).toBe('0');
  });
});
