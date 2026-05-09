import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import {
	getSettings,
	updateSettings,
	setSetting,
	initializeSettings,
	resetSettings as resetAppSettings
} from '$lib/utils/app-settings';
import type { AppSettings } from '@reborn/storage';
import { SUPPORTED_LOCALES } from '@reborn/i18n';
import { createLogger } from '@reborn/utils';
import { syncedSettings } from '$lib/services/synced-settings.service';

const logger = createLogger('app-settings-store');

/**
 * Reactive store for app-specific settings
 * Syncs with IndexedDB through @reborn/storage
 */
function createAppSettingsStore() {
	// Internal writable store for current settings
	const settings = writable<AppSettings | null>(null);
	const loading = writable(true);
	const error = writable<Error | null>(null);

	// Initialize settings when in browser
	async function init() {
		if (!browser) return;

		try {
			loading.set(true);
			error.set(null);

			// Initialize defaults if needed
			await initializeSettings();

			// Load current settings
			const currentSettings = await getSettings();

			// After logout → login, IndexedDB settings are recreated with defaults.
			// Adopt the locale preference from localStorage (set on auth pages or previous session)
			// so the user's choice survives the clearAllUserData() during logout.
			//
			// This runs AFTER syncedSettings.pullAndMerge() in the layout, so when
			// localStorage disagrees with the synced value the user is intentionally
			// overriding (e.g. picked a different language on the login page) — push
			// that choice up so other devices converge.
			if (currentSettings) {
				const savedLocale = localStorage.getItem('preferred_language') as AppSettings['language'] | null;
				if (
					savedLocale &&
					SUPPORTED_LOCALES.includes(savedLocale) &&
					savedLocale !== currentSettings.language
				) {
					currentSettings.language = savedLocale;
					await setSetting('language', savedLocale);
					syncedSettings.schedulePush();
				}
			}

			settings.set(currentSettings);

			// Apply theme immediately after loading from IndexedDB
			if (currentSettings?.theme) {
				applyTheme(currentSettings.theme);
			}

			// Apply language from IndexedDB so locale matches saved preference
			if (currentSettings?.language) {
				const { setLocale } = await import('./i18n.store');
				await setLocale(currentSettings.language);
			}

			logger.info('App settings initialized', { settings: currentSettings });
		} catch (err: unknown) {
			logger.error('Failed to initialize app settings', err);
			error.set(err instanceof Error ? err : new Error('Failed to initialize settings'));
		} finally {
			loading.set(false);
		}
	}

	// Update a single setting
	async function update<
		K extends keyof Omit<AppSettings, 'id' | 'app_name' | 'created_at' | 'updated_at'>
	>(key: K, value: AppSettings[K]) {
		try {
			error.set(null);

			// Update in IndexedDB
			await setSetting(key, value);

			// Reload settings to ensure consistency
			const updated = await getSettings();
			settings.set(updated);

			// Schedule debounced push to the server (E2E synced).
			// Coalesces rapid successive updates into a single round-trip.
			syncedSettings.schedulePush();

			logger.info('Setting updated', { key, value });

			// Apply side effects for specific settings
			if (key === 'theme' && browser) {
				applyTheme(value as AppSettings['theme']);
			}

			if (key === 'language' && browser) {
				// Language change will be handled by i18n store
				const { setLocale } = await import('./i18n.store');
				await setLocale(value as AppSettings['language']);
			}
		} catch (err: unknown) {
			logger.error('Failed to update setting', { key, value, error: err });
			error.set(err instanceof Error ? err : new Error('Failed to update setting'));
			throw err;
		}
	}

	// Update multiple settings at once
	async function updateMultiple(
		updates: Partial<Omit<AppSettings, 'id' | 'app_name' | 'created_at' | 'updated_at'>>
	) {
		try {
			error.set(null);

			// Update in IndexedDB
			await updateSettings(updates);

			// Reload settings
			const updated = await getSettings();
			settings.set(updated);

			// Schedule debounced push to the server (E2E synced).
			syncedSettings.schedulePush();

			logger.info('Settings updated', { updates });

			// Apply side effects
			if ('theme' in updates && browser) {
				applyTheme(updates.theme!);
			}

			if ('language' in updates && browser) {
				const { setLocale } = await import('./i18n.store');
				await setLocale(updates.language!);
			}
		} catch (err: unknown) {
			logger.error('Failed to update settings', { updates, error: err });
			error.set(err instanceof Error ? err : new Error('Failed to update settings'));
			throw err;
		}
	}

	// Reset to defaults
	async function reset() {
		try {
			error.set(null);
			loading.set(true);

			await resetAppSettings();
			const defaults = await getSettings();
			settings.set(defaults);

			// Push the new defaults so other devices converge.
			syncedSettings.schedulePush();

			// Apply default theme
			if (browser && defaults) {
				applyTheme(defaults.theme);

				// Apply default language
				const { setLocale } = await import('./i18n.store');
				await setLocale(defaults.language);
			}

			logger.info('Settings reset to defaults');
		} catch (err: unknown) {
			logger.error('Failed to reset settings', err);
			error.set(err instanceof Error ? err : new Error('Failed to reset settings'));
			throw err;
		} finally {
			loading.set(false);
		}
	}

	// NOTE: Do NOT auto-init here. Layout's onMount calls appSettings.init()
	// AFTER initializeStorage('task') ensures the database is ready.
	// Eager init causes a race condition: hasSettings() returns false because
	// the DB isn't open yet, leading to defaults (theme:'system') overwriting
	// the user's saved preference.

	return {
		subscribe: settings.subscribe,
		loading: { subscribe: loading.subscribe },
		error: { subscribe: error.subscribe },
		init,
		update,
		updateMultiple,
		reset,
		refresh: init // Alias for consistency
	};
}

/**
 * Apply theme to document and cache in localStorage for instant restore on next load.
 */
function applyTheme(theme: AppSettings['theme']) {
	if (!browser) return;

	const root = document.documentElement;

	if (theme === 'system') {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		root.classList.toggle('dark', prefersDark);
	} else {
		root.classList.toggle('dark', theme === 'dark');
	}

	// Cache in localStorage for the inline <script> in app.html (sync, no FOUC)
	try {
		localStorage.setItem('reborn-task-theme', theme);
	} catch {
		/* quota / private mode */
	}

	logger.debug('Theme applied', { theme });
}

// Create and export the store
export const appSettings = createAppSettingsStore();

// Derived stores for specific settings
export const currentTheme = derived(appSettings, ($settings) => $settings?.theme ?? 'system');

export const currentLanguage = derived(appSettings, ($settings) => $settings?.language ?? 'en');

export const dateFormat = derived(
	appSettings,
	($settings) => $settings?.dateFormat ?? 'YYYY-MM-DD'
);

export const timeFormat = derived(appSettings, ($settings) => $settings?.timeFormat ?? '24h');

export const firstDayOfWeek = derived(appSettings, ($settings) => $settings?.firstDayOfWeek ?? 1);

// Listen for system theme changes when theme is set to 'system'
if (browser) {
	const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

	// Subscribe to current theme setting
	currentTheme.subscribe((theme) => {
		if (theme === 'system') {
			applyTheme('system');
		}
	});

	// Listen for system preference changes
	mediaQuery.addEventListener('change', (e) => {
		const unsubscribe = currentTheme.subscribe((theme) => {
			if (theme === 'system') {
				document.documentElement.classList.toggle('dark', e.matches);
			}
		});
		// Immediately unsubscribe to avoid memory leaks
		unsubscribe();
	});
}
