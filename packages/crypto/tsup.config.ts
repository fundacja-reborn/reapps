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
        '@reborn/utils': ['../../utils/src/index.ts'],
        '@reborn/types': ['../../types/src/index.ts']
      }
    }
  },
  sourcemap: false,
  clean: true,
  external: ['@reborn/utils', '@reborn/types'],
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  outDir: 'dist'
});
