import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { backendConfig } from './config.js';
import { createBackendProxy } from './proxy.js';
import { serveStatic } from './static.js';

const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const host = process.env.HOST || '127.0.0.1';
const staticRoot = fileURLToPath(new URL('../preview/', import.meta.url));
const proxy = createBackendProxy(backendConfig(process.env));
const server = createServer((request, response) => {
  proxy(request, response, () => {
    void serveStatic(request, response, staticRoot);
  });
});
server.requestTimeout = 130_000;
server.listen(port, host, () => {
  console.info(`Frontend + BFF: http://${host}:${port}`);
});
