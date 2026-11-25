import { defineConfig } from 'tsup';

// Two entries: the dependency-free main entry and the Capacitor one
// (`@reborn/platform/native`). Capacitor packages are dependencies, so tsup
// keeps them external.
const entry = { index: 'src/index.ts', 'native/index': 'src/native/index.ts' };

export default defineConfig({
  entry,
  format: ['esm'],
  dts: {
    resolve: true,
    entry,
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
