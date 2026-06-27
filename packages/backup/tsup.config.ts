import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
    entry: ['src/index.ts'],
    // The dts build roots only at the entry, so the tsconfig's `composite: true`
    // (which demands every file be listed) trips TS6307. Disable it here - same
    // override the other packages use.
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
