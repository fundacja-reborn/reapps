import { defineConfig } from 'tsup';

export default defineConfig({
  // direction.ts and config.ts are extra entries: the dependency-free
  // `@reborn/i18n/direction` and `@reborn/i18n/config` subpaths that server
  // code imports (see package.json exports).
  entry: ['src/index.ts', 'src/direction.ts', 'src/config.ts'],
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
