import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}']
  },
  resolve: {
    alias: {
      '@reborn/types': resolve(__dirname, '../types/src'),
      '@reborn/utils': resolve(__dirname, '../utils/src'),
      '@reborn/crypto': resolve(__dirname, '../crypto/src')
    }
  }
});
