import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: ['src/index.ts'],
    compilerOptions: {
      composite: false,
      incremental: false,
      paths: {
        '@reborn/crypto': ['../../crypto/src/index.ts'],
        '@reborn/types': ['../../types/src/index.ts'],
        '@reborn/utils': ['../../utils/src/index.ts']
      }
    }
  },
  sourcemap: false,
  clean: true,
  external: ['@reborn/crypto', '@reborn/types', '@reborn/utils', 'svelte', 'svelte/store'],
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  outDir: 'dist'
});
