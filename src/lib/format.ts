function parts(value: string | null) {
  return value?.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/) ?? null;
}

/** Format backend decimals exactly, including Python Decimal's exponent notation. */
export function decimal(value: string | null, unknown = 'Неизвестно') {
  const match = parts(value);
  if (!match) return unknown;
  const [, sign, integer, fraction = '', exponent = '0'] = match;
  const shift = Number(exponent);
  // Keep unusual magnitudes readable without allocating an unbounded string.
  if (Math.abs(shift) > 1000) return value!;
  const digits = integer + fraction;
  const point = integer.length + shift;
  const whole =
    point <= 0 ? '0' : point >= digits.length ? digits.padEnd(point, '0') : digits.slice(0, point);
  const tail = point <= 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return `${sign}${grouped}${tail ? `,${tail}` : ''}`;
}

export const money = (amount: string | null) => decimal(amount, 'Цена не указана');

/** The API accepts only whole quantities up to int32, even for fractional stock. */
export function availableWholeUnits(value: string | null) {
  const match = parts(value);
  if (!match || match[1] === '-') return 0;
  const [, , integer, fraction = '', exponent = '0'] = match;
  const digits = integer + fraction;
  const significant = digits.replace(/^0+/, '');
  if (!significant) return 0;
  const point = integer.length + Number(exponent) - (digits.length - significant.length);
  if (point <= 0) return 0;
  if (point > 10) return 2147483647;
  const whole = BigInt(significant.slice(0, point).padEnd(point, '0'));
  return Number(whole > 2147483647n ? 2147483647n : whole);
}

export function hasPositiveStock(value: string | null) {
  const match = parts(value);
  return Boolean(match && match[1] !== '-' && /[1-9]/.test(match[2] + (match[3] ?? '')));
}

export function safeUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
