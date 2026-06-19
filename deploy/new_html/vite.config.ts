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
      // 安全(H8)：绝不把真实 GEMINI_API_KEY 注入前端 bundle（会随公开 JS 泄露）。
      // 前端所有 AI 调用都走后端代理；这些占位仅防止历史代码或依赖误读 process.env。
      define: {
        'process.env.API_KEY': JSON.stringify('DISABLED_CLIENT_KEY'),
        'process.env.GEMINI_API_KEY': JSON.stringify('DISABLED_CLIENT_KEY')
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
