import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, proxy: {
    '/api': 'http://127.0.0.1:2567',
    '/matchmake': 'http://127.0.0.1:2567',
    '/realtime': { target: 'ws://127.0.0.1:2567', ws: true, rewrite: p => p.replace(/^\/realtime/, '') },
  } },
  build: { rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } } },
});
