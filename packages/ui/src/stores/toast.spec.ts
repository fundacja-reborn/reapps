import { beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn()
}));

vi.mock('svelte-sonner', () => ({ toast: sonner }));

import { toastStore } from './toast';

describe('toastStore.error', () => {
	beforeEach(() => {
		sonner.error.mockClear();
		sonner.success.mockClear();
	});

	it('stays until closed and has a close button', () => {
		toastStore.error('Export failed');

		const [message, options] = sonner.error.mock.calls[0];
		expect(message).toBe('Export failed');
		expect(options.duration).toBe(Number.POSITIVE_INFINITY);
		expect(options.closeButton).toBe(true);
	});

	it('replaces the same message on screen instead of stacking it', () => {
		toastStore.error('Sync failed');
		toastStore.error('Sync failed');
		toastStore.error('Export failed');

		const ids = sonner.error.mock.calls.map(([, options]) => options.id);
		expect(ids[0]).toBe(ids[1]);
		expect(ids[2]).not.toBe(ids[0]);
	});

	it('keeps a duration or id the caller sets', () => {
		toastStore.error('Short', { duration: 3000, id: 'mine' });

		const [, options] = sonner.error.mock.calls[0];
		expect(options.duration).toBe(3000);
		expect(options.id).toBe('mine');
	});

	it('leaves other toasts on the timeout', () => {
		toastStore.success('Saved');

		const [, options] = sonner.success.mock.calls[0];
		expect(options.duration).toBeUndefined();
		expect(options.closeButton).toBeUndefined();
	});
});
