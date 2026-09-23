import { describe, expect, it } from 'vitest';
import { availableWholeUnits, decimal, hasPositiveStock, money, safeUrl } from './format';

describe('backend decimals', () => {
  it('preserves precision, trailing decimals and zero without inventing currency', () => {
    expect(money('9007199254740993.012345')).toBe(
      '9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,012345',
    );
    expect(money('850.00')).toBe('850,00');
    expect(money('0')).toBe('0');
    expect(money(null)).toBe('Цена не указана');
    expect(decimal(null)).toBe('Неизвестно');
  });

  it('handles decimal exponent notation without treating its exponent as stock', () => {
    expect(decimal('0E-10')).toBe('0,0000000000');
    expect(decimal('1.25E3')).toBe('1\u00a0250');
    expect(decimal('1.25E-3')).toBe('0,00125');
    expect(hasPositiveStock('0E-10')).toBe(false);
    expect(hasPositiveStock('1E-10')).toBe(true);
    expect(availableWholeUnits('1.25E3')).toBe(1250);
    expect(availableWholeUnits('1E-10')).toBe(0);
  });

  it('floors fractional stock and caps accepted quantities to the API int32 limit', () => {
    expect(availableWholeUnits('12.999999999')).toBe(12);
    expect(availableWholeUnits('0.9999')).toBe(0);
    expect(availableWholeUnits(null)).toBe(0);
    expect(availableWholeUnits('9007199254740993')).toBe(2147483647);
    expect(availableWholeUnits('1E1000000')).toBe(2147483647);
  });

  it('allows only HTTP(S) product links', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,content')).toBeUndefined();
    expect(safeUrl('https://ekt.kz/product')).toBe('https://ekt.kz/product');
  });
});
