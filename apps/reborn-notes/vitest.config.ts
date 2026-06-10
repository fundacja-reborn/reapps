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
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    passWithNoTests: true
  }
});
