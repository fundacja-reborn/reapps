import { defineConfig } from 'tsup';

export default defineConfig({
  // direction.ts is a second entry: the dependency-free `@reborn/i18n/direction`
  // subpath the server imports (see package.json exports).
  entry: ['src/index.ts', 'src/direction.ts'],
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
