import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
) {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405).end();
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const target = resolve(root, path === '/' ? 'index.html' : `.${path}`);
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const file = await stat(target);
    if (!file.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', contentTypes[extname(target)] || 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Cache-Control',
      extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600',
    );
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(target)
      .on('error', () => response.destroy())
      .pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}
