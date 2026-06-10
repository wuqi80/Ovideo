/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: 'http://localhost:8000',
            changeOrigin: true
          },
          '/uploads': {
            target: 'http://localhost:8000',
            changeOrigin: true
          }
        },
        historyApiFallback: true
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      base: '/',
      build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom'],
              utils: ['uuid', 'lucide-react']
            }
          }
        }
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./test/setup.ts'],
        include: ['__tests__/**/*.test.{ts,tsx}'],
        css: false,
      },
    };
});
