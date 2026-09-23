import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { backendPlugin } from './server/vitePlugin';

export default defineConfig(({ mode }) => {
  const backendEnv = loadEnv(mode, 'backend/hack-e3d8b0d1-strikers-club', '');
  const frontendEnv = loadEnv(mode, process.cwd(), '');
  return {
    // The backend key stays inside the Vite BFF and is never exposed as VITE_*.
    plugins: [react(), backendPlugin({ ...backendEnv, ...frontendEnv, ...process.env })],
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist/preview', chunkSizeWarningLimit: 1100 },
    test: {
      environment: 'jsdom',
      css: true,
      restoreMocks: true,
    },
  };
});
