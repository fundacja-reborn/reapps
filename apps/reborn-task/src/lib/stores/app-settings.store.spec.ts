import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Forward-compat cover for the synced `language` setting.
 *
 * `language` is E2E synced across devices and shared by both apps, so a newer
 * client can write a locale this build does not ship. Init must then neither
 * fail (it used to throw in setLocale and set the error store) nor let the
 * device's localStorage locale overwrite the synced value and push it back -
 * that would erase the user's choice on every device. Known locales keep the
 * existing "localStorage wins" behaviour.
 *
 * `@reborn/i18n` is mocked with an inline mirror of its two pure guards so the
 * test depends on neither the built package nor svelte-i18n setup.
 */

const mocks = vi.hoisted(() => {
	// The store wires a prefers-color-scheme listener at import time.
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	})) as unknown as typeof window.matchMedia;

	return {
		getSettings: vi.fn(),
		setSetting: vi.fn(),
		initializeSettings: vi.fn(),
		schedulePush: vi.fn(),
		setLocale: vi.fn()
	};
});

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/utils/app-settings', () => ({
	getSettings: mocks.getSettings,
	updateSettings: vi.fn(),
	setSetting: mocks.setSetting,
	initializeSettings: mocks.initializeSettings,
	resetSettings: vi.fn()
}));
vi.mock('$lib/services/synced-settings.service', () => ({
	syncedSettings: { schedulePush: mocks.schedulePush }
}));
vi.mock('./i18n.store', () => ({ setLocale: mocks.setLocale }));
vi.mock('@reborn/utils', () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));
vi.mock('@reborn/i18n', async () => {
	const { writable } = await import('svelte/store');
	const supported = ['en', 'pl', 'de', 'es', 'fr'];
	const isSupportedLocale = (value: unknown): value is string =>
		typeof value === 'string' && supported.includes(value);
	return {
		isSupportedLocale,
		resolveLocale: (preferred: unknown, current?: unknown) =>
			isSupportedLocale(preferred) ? preferred : isSupportedLocale(current) ? current : 'en',
		locale: writable('pl')
	};
});

import { appSettings, currentLanguage } from './app-settings.store';

function settingsRow(overrides: Record<string, unknown>) {
	return { app_name: 'reborn-task', theme: 'dark', language: 'pl', ...overrides };
}

describe('appSettings.init - synced language this build does not ship', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		localStorage.setItem('preferred_language', 'pl');
		document.documentElement.classList.remove('dark');
	});

	it('keeps the synced value and does not push the local locale over it', async () => {
		mocks.getSettings.mockResolvedValue(settingsRow({ language: 'ar' }));

		await appSettings.init();

		expect(mocks.setSetting).not.toHaveBeenCalled();
		expect(mocks.schedulePush).not.toHaveBeenCalled();
		expect(get(appSettings)?.language).toBe('ar');
	});

	it('finishes without an error and keeps the theme', async () => {
		mocks.getSettings.mockResolvedValue(settingsRow({ language: 'ar', theme: 'dark' }));

		await appSettings.init();

		expect(get(appSettings.error)).toBeNull();
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('exposes the locale the UI renders, not the raw unsupported code', async () => {
		mocks.getSettings.mockResolvedValue(settingsRow({ language: 'ar' }));

		await appSettings.init();

		expect(get(currentLanguage)).toBe('pl');
	});

	it('still lets a different supported localStorage locale win and syncs it', async () => {
		mocks.getSettings.mockResolvedValue(settingsRow({ language: 'de' }));

		await appSettings.init();

		expect(mocks.setSetting).toHaveBeenCalledWith('language', 'pl');
		expect(mocks.schedulePush).toHaveBeenCalledOnce();
		expect(get(currentLanguage)).toBe('pl');
	});
});
