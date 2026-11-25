/**
 * Test stub for SvelteKit's `$env/dynamic/public` (aliased in vitest.config.ts).
 *
 * The real module reads the env object SvelteKit's client bootstrap installs
 * on `globalThis`, which does not exist under vitest - importing it there
 * throws "Cannot read properties of undefined (reading 'env')", so any spec
 * whose module graph reaches `$lib/utils/api-base` would fail to load. Tests
 * run as the web build: no PUBLIC_API_BASE_URL, so API_BASE is `${base}/api`.
 */
export const env: Record<string, string | undefined> = {};
