// @vitest-environment node
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { backendConfig } from './config';
import { createRateLimiter } from './security';

describe('BFF server configuration', () => {
  it('keeps credentials server-side and permits only configured HTTP origins', () => {
    expect(backendConfig({ API_KEY: 'fallback' }).apiKey).toBe('fallback');
    expect(backendConfig({ VITE_API_KEY: 'must-not-be-used' }).apiKey).toBe('');
    for (const value of [
      'file:///etc/passwd',
      'http://user:secret@localhost',
      'http://localhost/api',
      'http://localhost?key=secret',
    ]) {
      expect(() => backendConfig({ BACKEND_URL: value })).toThrow();
    }
    expect(() => backendConfig({ BACKEND_API_PREFIX: '/api/../private' })).toThrow();
  });

  it('limits requests by direct peer, ignoring spoofable forwarded headers', () => {
    const rateLimit = createRateLimiter(2);
    const request = (forwarded: string) =>
      ({
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-forwarded-for': forwarded },
      }) as unknown as IncomingMessage;
    rateLimit(request('1.1.1.1'), false);
    rateLimit(request('2.2.2.2'), false);
    expect(() => rateLimit(request('3.3.3.3'), false)).toThrow('Слишком много');
  });

  it('limits anonymous session creation separately', () => {
    const rateLimit = createRateLimiter();
    const request = { socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage;
    for (let i = 0; i < 10; i += 1) rateLimit(request, true);
    expect(() => rateLimit(request, true)).toThrow('Слишком много');
  });
});
