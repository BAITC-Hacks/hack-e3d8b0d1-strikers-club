export interface BackendConfig {
  origin: string;
  prefix: string;
  apiKey: string;
  publicOrigin?: string;
  timeoutMs: number;
  jsonLimit: number;
  uploadLimit: number;
}

function origin(value: string, name: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(`${name} must be an HTTP(S) origin without credentials or a path`);
  return url.origin;
}

export function backendConfig(env: Record<string, string | undefined>): BackendConfig {
  const prefix = (env.BACKEND_API_PREFIX ?? '/api').replace(/\/$/, '');
  if (!/^\/[A-Za-z0-9_/-]*$/.test(prefix) || prefix.includes('//')) {
    throw new Error('BACKEND_API_PREFIX must be an absolute URL path');
  }
  return {
    origin: origin(env.BACKEND_URL || 'http://127.0.0.1:8000', 'BACKEND_URL'),
    prefix,
    apiKey: env.BACKEND_API_KEY || env.API_KEY || '',
    publicOrigin: env.PUBLIC_ORIGIN ? origin(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN') : undefined,
    timeoutMs: 120_000,
    jsonLimit: 16_384,
    uploadLimit: 20 * 1024 * 1024,
  };
}
