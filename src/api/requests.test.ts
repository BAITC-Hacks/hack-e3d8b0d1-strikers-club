import { describe, expect, it } from 'vitest';
import { chatRequest, confirmationRequest, uploadRequest } from './requests';
import { proposalFixture } from './fixtures';
import { uploadMime } from '../lib/attachments';

describe('request validation', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, '2', true])(
    'rejects invalid confirmation quantity %j',
    (quantity) => {
      expect(() =>
        confirmationRequest('session', { ...proposalFixture, quantity: quantity as number }),
      ).toThrow('целое');
    },
  );

  it('accepts integer bounds without adding price or other fields', () => {
    const request = confirmationRequest('session', { ...proposalFixture, quantity: 2147483647 });
    expect(JSON.parse(request.body as string)).toEqual({
      session_id: 'session',
      operation_id: proposalFixture.operation_id,
      product_id: proposalFixture.product_id,
      quantity: 2147483647,
    });
  });

  it('limits trimmed characters and exact UTF-8 JSON bytes', () => {
    expect(() => chatRequest('session', '   ')).toThrow('от 1');
    expect(() => chatRequest('session', 'a'.repeat(8001))).toThrow('8000');
    expect(() => chatRequest('session', 'я'.repeat(8000))).not.toThrow();
    expect(() => chatRequest('session', '界'.repeat(6000))).toThrow('Сократите');
    expect(() => chatRequest('session', String.fromCharCode(0).repeat(4000))).toThrow('Сократите');
    expect(JSON.parse(chatRequest('session', '  Привет  ').body as string)).toEqual({
      session_id: 'session',
      message: 'Привет',
    });
  });

  it.each(Object.entries(uploadMime))('sends %s as raw bytes with its MIME', (extension, mime) => {
    const file = new File(['data'], `файл.${extension}`, { type: 'application/octet-stream' });
    const request = uploadRequest(file);
    expect(request.body).toBe(file);
    expect(new Headers(request.headers).get('Content-Type')).toBe(mime);
    expect(new Headers(request.headers).get('X-Filename')).toBe(`attachment.${extension}`);
  });

  it.each(['doc', 'xls', 'svg', 'exe', 'txt'])('rejects unsupported .%s files', (extension) => {
    expect(() => uploadRequest(new File(['data'], `file.${extension}`))).toThrow('Файл не прошёл');
  });

  it('rejects empty and oversized files', () => {
    expect(() => uploadRequest(new File([], 'empty.pdf'))).toThrow('пуст');
    const file = new File(['data'], 'large.pdf');
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 });
    expect(() => uploadRequest(file)).toThrow('большой');
  });
});
