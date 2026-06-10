import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: ['src/index.ts'],
    compilerOptions: {
      composite: false,
      incremental: false
    }
  },
  sourcemap: false,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  outDir: 'dist'
});
