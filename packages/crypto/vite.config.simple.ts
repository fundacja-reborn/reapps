import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '../../dist/packages/crypto',
    lib: {
      entry: './src/index.ts',
      name: 'reborn-crypto',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: ['@reborn/utils', '@reborn/types']
    }
  }
});
