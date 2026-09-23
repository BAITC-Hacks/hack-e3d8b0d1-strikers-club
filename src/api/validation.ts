export function invalid(field: string): never {
  throw new Error(`Backend вернул некорректное поле «${field}».`);
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}

export function string(value: unknown, field: string): string {
  return typeof value === 'string' ? value : invalid(field);
}

export function text(value: unknown, field: string): string {
  return typeof value === 'string' && value.trim() ? value : invalid(field);
}

export function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : string(value, field);
}

export function boolean(value: unknown, field: string): boolean {
  return typeof value === 'boolean' ? value : invalid(field);
}

export function literal<T extends string | boolean>(value: unknown, expected: T, field: string): T {
  return value === expected ? expected : invalid(field);
}

export function decimal(value: unknown, field: string): string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
    ? value
    : invalid(field);
}

export function nullableDecimal(value: unknown, field: string): string | null {
  return value === null ? null : decimal(value, field);
}

export function nonNegative(value: unknown, field: string): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid(field);
}

export function quantity(
  value: unknown,
  field: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const number = nonNegative(value, field);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : invalid(field);
}

export function probability(value: unknown, field: string): number {
  const result = nonNegative(value, field);
  return result <= 1 ? result : invalid(field);
}

export function array(value: unknown, field: string): unknown[] {
  return Array.isArray(value) ? value : invalid(field);
}

export function textArray(value: unknown, field: string): string[] {
  return array(value, field).map((entry) => string(entry, field));
}

/** Decode server html.escape once; React still renders the result as plain text. */
export function decodeMessage(value: unknown): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return string(value, 'сообщение').replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (whole, code: string) => {
      if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? whole;
      const point =
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : '\uFFFD';
    },
  );
}
