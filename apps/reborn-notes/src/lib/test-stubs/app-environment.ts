/**
 * Test stub for SvelteKit's `$app/environment`.
 *
 * The notes vitest config is standalone (no sveltekit plugin), so `$app/*`
 * specifiers are otherwise unresolvable. This lets specs import modules that
 * pull in `$app/environment`; specs that need `browser === true` override it
 * with `vi.mock('$app/environment', () => ({ browser: true }))`.
 */
export const browser = false;
