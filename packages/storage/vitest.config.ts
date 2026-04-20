import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@reborn/types': resolve(__dirname, '../types/src'),
      '@reborn/utils': resolve(__dirname, '../utils/src'),
      '@reborn/crypto': resolve(__dirname, '../crypto/src')
    }
  }
});
