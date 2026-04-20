import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']
  },
  resolve: {
    alias: {
      '@reborn/types': resolve(__dirname, '../types/src'),
      '@reborn/utils': resolve(__dirname, '../utils/src'),
      '@reborn/crypto': resolve(__dirname, '../crypto/src'),
      '@reborn/auth': resolve(__dirname, '../auth/src')
    }
  }
});
