import { defineConfig, mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    // `$env/dynamic/public` needs SvelteKit's client bootstrap; tests get an
    // empty env (the web build) instead - see the stub's header.
    resolve: {
      alias: {
        '$env/dynamic/public': fileURLToPath(
          new URL('./src/lib/test-stubs/env-dynamic-public.ts', import.meta.url)
        )
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']
    }
  })
);
