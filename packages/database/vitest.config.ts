import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@reborn/database': path.resolve(__dirname, './src'),
      '@reborn/types': path.resolve(__dirname, '../types/src'),
      '@reborn/utils': path.resolve(__dirname, '../utils/src'),
    },
  },
});
