import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Tests run as the web build: the native flag is statically false.
  define: {
    __REBORN_NATIVE__: 'false'
  },
  // Resolve SvelteKit's `$lib` alias so specs can import real (unmocked)
  // `$lib/...` modules - e.g. `$lib/utils/native-client`. Existing specs that
  // `vi.mock('$lib/...')` are unaffected (the mock still matches the specifier).
  // `$app/environment` maps to a stub (no sveltekit plugin here to provide it);
  // specs needing `browser === true` still override it via `vi.mock`.
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '$app/environment': fileURLToPath(
        new URL('./src/lib/test-stubs/app-environment.ts', import.meta.url)
      )
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    passWithNoTests: true
  }
});
