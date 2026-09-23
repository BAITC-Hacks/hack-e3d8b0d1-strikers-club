import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/widget',
    lib: {
      entry: 'src/widget.tsx',
      formats: ['es'],
      fileName: () => 'ekt-assistant.js',
      cssFileName: 'ekt-ai-assistant',
    },
    rollupOptions: {
      external:
        /^(react|react-dom|react-redux|@reduxjs\/toolkit|@tanstack\/react-query|@mui\/material|@emotion\/[^/]+)(\/|$)/,
    },
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1100,
  },
});
