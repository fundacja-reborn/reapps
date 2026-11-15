import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import type { ListDecrypted } from '@reborn/types';

/**
 * The active list is the decrypted list the user is looking at. It used to be
 * written to localStorage whole - its name in plaintext, outside the encrypted
 * IndexedDB records and still there after a lock or with the app closed.
 * These tests pin the store to memory and make sure the old entry is removed.
 */

const LEGACY_KEY = 'reborn-task-active-list';

vi.mock('$app/environment', () => ({ browser: true }));

const list = (id: string, name: string) => ({ id, name }) as unknown as ListDecrypted;

async function loadStore() {
	vi.resetModules();
	const { activeListStore } = await import('./active-list.store');
	return activeListStore;
}

describe('activeListStore', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('removes the plaintext entry left by earlier versions', async () => {
		localStorage.setItem(LEGACY_KEY, JSON.stringify(list('l1', 'Private errands')));

		const store = await loadStore();

		expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
		expect(get(store)).toBeNull();
	});

	it('never writes the list - or anything else - to localStorage', async () => {
		const store = await loadStore();

		store.set(list('l1', 'Private errands'));
		store.updateIfMatches('l1', list('l1', 'Renamed errands'));

		expect(get(store)?.name).toBe('Renamed errands');
		expect(localStorage.length).toBe(0);
		expect(JSON.stringify({ ...localStorage })).not.toContain('errands');
	});

	it('keeps its in-memory behaviour', async () => {
		const store = await loadStore();

		store.set(list('l1', 'One'));
		store.updateIfMatches('other', list('other', 'Ignored'));
		expect(get(store)?.name).toBe('One');

		store.clear();
		expect(get(store)).toBeNull();
	});
});
