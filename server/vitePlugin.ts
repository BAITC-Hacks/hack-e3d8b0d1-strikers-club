import type { Plugin } from 'vite';
import { backendConfig } from './config.js';
import { createBackendProxy } from './proxy.js';

export function backendPlugin(env: Record<string, string | undefined>): Plugin {
  const config = backendConfig(env);
  return {
    name: 'strikers-backend-proxy',
    configureServer(server) {
      server.middlewares.use(createBackendProxy(config));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createBackendProxy(config));
    },
  };
}
