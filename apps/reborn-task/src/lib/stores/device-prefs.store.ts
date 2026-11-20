import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('device-prefs');

/**
 * Per-device UI preferences.
 *
 * Unlike `appSettings` (E2E-synced across all of a user's devices), these live
 * ONLY in this device's localStorage and never sync. They capture how *this*
 * device should behave. There is no user content here (flags only), so plain
 * localStorage is fine and outside the Zero-Knowledge sync surface.
 */
export interface DevicePrefs {
	/**
	 * Phone layout only: show the floating "New task" button in the bottom
	 * corner of the task list. On by default - adding a task is the app's main
	 * action, the rail's button sits in the corner the thumb reaches last and
	 * the quick-add field of a long list is below the fold. A matter of how this
	 * device is held, so it stays per device.
	 */
	newTaskFab: boolean;
}

const STORAGE_KEY = 'reborn-task-device-prefs';

const DEFAULTS: DevicePrefs = {
	newTaskFab: true
};

function load(): DevicePrefs {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<DevicePrefs> | null;
		return {
			newTaskFab:
				typeof parsed?.newTaskFab === 'boolean' ? parsed.newTaskFab : DEFAULTS.newTaskFab
		};
	} catch (err) {
		logger.warn('Failed to read device prefs, using defaults', err);
		return { ...DEFAULTS };
	}
}

function persist(prefs: DevicePrefs): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch (err) {
		// Quota / private mode - keep the in-memory value, just skip persistence.
		logger.warn('Failed to persist device prefs', err);
	}
}

function createDevicePrefsStore() {
	const store = writable<DevicePrefs>(load());

	function setNewTaskFab(enabled: boolean): void {
		store.update((prev) => {
			const next = { ...prev, newTaskFab: enabled };
			persist(next);
			return next;
		});
	}

	/** Everything back to the defaults (Appearance > Reset to defaults). */
	function reset(): void {
		const next = { ...DEFAULTS };
		persist(next);
		store.set(next);
	}

	return {
		subscribe: store.subscribe,
		setNewTaskFab,
		reset
	};
}

export const devicePrefs = createDevicePrefsStore();

/** Phone layout: whether the floating "New task" button is shown on this device. */
export const newTaskFab = derived(devicePrefs, ($p) => $p.newTaskFab);
