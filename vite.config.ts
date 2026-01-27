import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'browser/service-worker.ts'),
        'content-script': resolve(__dirname, 'browser/content-script.ts'),
        'offscreen': resolve(__dirname, 'runtime/offscreen.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false, // Easier debugging during development
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@pilot': resolve(__dirname),
    },
  },
  // Handle WebLLM WASM imports
  optimizeDeps: {
    exclude: ['@anthropic/webllm'],
  },
  worker: {
    format: 'es',
  },
});
