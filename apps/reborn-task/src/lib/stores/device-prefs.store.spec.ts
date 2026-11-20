// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Per-device prefs (localStorage, never synced, validated on load): the
 * floating "New task" button of the phone layout.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const STORAGE_KEY = 'reborn-task-device-prefs';

async function loadStore() {
	vi.resetModules();
	return import('./device-prefs.store');
}

function stored(): Record<string, unknown> {
	return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
}

beforeEach(() => {
	localStorage.clear();
});

describe('device prefs: floating "New task" button', () => {
	it('is on by default', async () => {
		const { newTaskFab, devicePrefs } = await loadStore();
		expect(get(newTaskFab)).toBe(true);
		expect(get(devicePrefs)).toEqual({ newTaskFab: true });
	});

	it('persists the choice for this device', async () => {
		const first = await loadStore();
		first.devicePrefs.setNewTaskFab(false);
		expect(stored()).toMatchObject({ newTaskFab: false });

		const second = await loadStore();
		expect(get(second.newTaskFab)).toBe(false);
	});

	it.each([
		['a string', 'no'],
		['a number', 0],
		['null', null]
	])('falls back to on for %s', async (_label, value) => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ newTaskFab: value }));
		const { newTaskFab } = await loadStore();
		expect(get(newTaskFab)).toBe(true);
	});

	it.each([
		['broken JSON', '{not json'],
		['a JSON null', 'null']
	])('falls back to the defaults for %s', async (_label, raw) => {
		localStorage.setItem(STORAGE_KEY, raw);
		const { devicePrefs } = await loadStore();
		expect(get(devicePrefs)).toEqual({ newTaskFab: true });
	});

	it('reset() restores the default and persists it', async () => {
		const { devicePrefs, newTaskFab } = await loadStore();
		devicePrefs.setNewTaskFab(false);
		devicePrefs.reset();
		expect(get(newTaskFab)).toBe(true);
		expect(stored()).toEqual({ newTaskFab: true });
	});
});
