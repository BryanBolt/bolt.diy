import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
      '/ideas': { target: 'http://localhost:8787' },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
