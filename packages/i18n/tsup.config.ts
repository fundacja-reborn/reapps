import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: false,
  external: ['svelte', 'svelte/*', 'svelte-i18n'],
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  esbuildOptions(options) {
    options.platform = 'browser';
  }
});
