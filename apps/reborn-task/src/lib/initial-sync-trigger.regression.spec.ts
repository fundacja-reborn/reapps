import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: re/task opened with a restored master key (page reload, PWA
 * restart, first visit after signing in through re/notes) skipped the initial
 * pull on most fast loads. With an empty local database that is an empty app
 * showing "Synced".
 *
 * The pull on a cold start is started only by the `$session.hasE2E` effect in
 * the root layout, guarded by the one-shot `hasTriggeredInitialSync`. onMount's
 * `init()` also set that flag ("E2E already active on mount") without starting
 * any sync. `$session` trails the SessionManager (auth.store.ts attaches on a
 * 100 ms retry timer), so on a fast load `init()` finished first, the effect
 * then found the flag set and returned.
 *
 * The root layout pulls in IndexedDB, cryptoManager, $app and $env, which are
 * impractical to mount in Node, so these are source assertions that pin the
 * wiring (same approach as sync.push-rejection.spec.ts).
 */
const layout = readFileSync(resolve(__dirname, '../routes/+layout.svelte'), 'utf-8');

const SET_FLAG = /hasTriggeredInitialSync\s*=\s*true/g;

describe('re/task root layout - initial sync trigger (regression)', () => {
	it('sets the one-shot flag in exactly one place', () => {
		expect(layout.match(SET_FLAG) ?? []).toHaveLength(1);
	});

	it('sets it inside the hasE2E effect, which then starts the initial sync', () => {
		const start = layout.indexOf('if (hasTriggeredInitialSync) return;');
		const end = layout.indexOf('runSync().catch');
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);

		const effect = layout.slice(start, end);
		expect(effect.match(SET_FLAG) ?? []).toHaveLength(1);
		expect(effect).toMatch(/await syncService\.initialSync\(\)/);

		// The guard sits behind the hasE2E check of the same effect.
		const head = layout.slice(layout.lastIndexOf('$effect(', start), start);
		expect(head).toMatch(/!\$session\?\.hasE2E\)\s*return;/);
	});

	it('onMount init() does not claim the initial sync', () => {
		const start = layout.indexOf('const init = async () =>');
		const end = layout.indexOf('init().catch');
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);

		const init = layout.slice(start, end);
		expect(init).not.toMatch(/hasTriggeredInitialSync/);
		// init() never starts the pull itself, so it has nothing to deduplicate.
		expect(init).not.toMatch(/initialSync\(/);
	});
});
