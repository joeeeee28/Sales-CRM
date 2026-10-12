import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = process.env.PORT ?? '4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(here, 'shared'),
      '@': path.resolve(here, 'src'),
    },
  },
  build: {
    outDir: 'dist/public',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: false },
      '/media': { target: `http://localhost:${API_PORT}`, changeOrigin: false },
    },
  },
});
