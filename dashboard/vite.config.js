import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
