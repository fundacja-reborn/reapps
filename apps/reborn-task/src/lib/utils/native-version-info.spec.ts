import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNativeVersionInfo } from './native-version-info';

// Under vitest `__REBORN_NATIVE__` is the web build's `false` (vite define),
// so this pins the web half: no version detail, no request. The native half
// (App.getInfo + /api/app-config) is covered by the device smoke.
describe('getNativeVersionInfo (web build)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns null without touching the network', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		await expect(getNativeVersionInfo()).resolves.toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
