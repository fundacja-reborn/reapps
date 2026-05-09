import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import {
  getSettings,
  updateSettings,
  setSetting,
  initializeSettings,
  resetSettings as resetAppSettings
} from '$lib/utils/app-settings';
import type { AppSettings, PeriodicNotesSettings } from '@reborn/storage';
import { PERIODIC_NOTES_DEFAULTS } from '@reborn/storage';
import { SUPPORTED_LOCALES } from '@reborn/i18n';
import { createLogger } from '@reborn/utils';
import { syncedSettings } from '$lib/services/synced-settings.service';

const logger = createLogger('app-settings-store');

function createAppSettingsStore() {
  const settings = writable<AppSettings | null>(null);
  const loading = writable(true);
  const error = writable<Error | null>(null);

  async function init() {
    if (!browser) return;

    try {
      loading.set(true);
      error.set(null);

      await initializeSettings();

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

  async function update<
    K extends keyof Omit<AppSettings, 'id' | 'app_name' | 'created_at' | 'updated_at'>
  >(key: K, value: AppSettings[K]) {
    try {
      error.set(null);

      await setSetting(key, value);

      const updated = await getSettings();
      settings.set(updated);

      // Schedule debounced push to the server (E2E synced).
      syncedSettings.schedulePush();

      logger.info('Setting updated', { key, value });

      if (key === 'theme' && browser) {
        applyTheme(value as AppSettings['theme']);
      }

      if (key === 'language' && browser) {
        const { setLocale } = await import('./i18n.store');
        await setLocale(value as AppSettings['language']);
      }
    } catch (err: unknown) {
      logger.error('Failed to update setting', { key, value, error: err });
      error.set(err instanceof Error ? err : new Error('Failed to update setting'));
      throw err;
    }
  }

  async function updateMultiple(
    updates: Partial<Omit<AppSettings, 'id' | 'app_name' | 'created_at' | 'updated_at'>>
  ) {
    try {
      error.set(null);

      await updateSettings(updates);

      const updated = await getSettings();
      settings.set(updated);

      // Schedule debounced push to the server (E2E synced).
      syncedSettings.schedulePush();

      logger.info('Settings updated', { updates });

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

  async function reset() {
    try {
      error.set(null);
      loading.set(true);

      await resetAppSettings();
      const defaults = await getSettings();
      settings.set(defaults);

      // Push the new defaults so other devices converge.
      syncedSettings.schedulePush();

      if (browser && defaults) {
        applyTheme(defaults.theme);

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

  // NOTE: Do NOT auto-init here. Layout calls initializeSettings()
  // AFTER initializeStorage('notes') ensures the database is ready.
  // Eager init causes a race condition — see reborn-task for details.

  return {
    subscribe: settings.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },
    init,
    update,
    updateMultiple,
    reset,
    refresh: init
  };
}

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
    localStorage.setItem('reborn-notes-theme', theme);
  } catch {
    /* quota / private mode */
  }

  logger.debug('Theme applied', { theme });
}

export const appSettings = createAppSettingsStore();

export const currentTheme = derived(appSettings, ($settings) => $settings?.theme ?? 'system');

export const currentLanguage = derived(appSettings, ($settings) => $settings?.language ?? 'en');

export const dateFormat = derived(
  appSettings,
  ($settings) => $settings?.dateFormat ?? 'YYYY-MM-DD'
);

export const timeFormat = derived(appSettings, ($settings) => $settings?.timeFormat ?? '24h');

export const firstDayOfWeek = derived(appSettings, ($settings) => $settings?.firstDayOfWeek ?? 1);

export const imageLoadMode = derived(appSettings, ($settings) => $settings?.imageLoadMode ?? 'ask');

export const editorMode = derived(appSettings, ($settings) => $settings?.editorMode ?? 'live');

export const editorModeIntroSeen = derived(
  appSettings,
  ($settings) => $settings?.editorModeIntroSeen ?? false
);

/**
 * Per-kind Periodic Notes settings (Daily / Weekly / Monthly).
 * Falls back to defaults when settings haven't loaded yet so consumers can
 * render eagerly without null checks; missing kinds (e.g. legacy settings
 * pre-migration) inherit defaults too.
 */
export const periodicNotesSettings = derived<typeof appSettings, PeriodicNotesSettings>(
  appSettings,
  ($settings) => {
    const stored = $settings?.periodicNotes;
    return {
      daily: { ...PERIODIC_NOTES_DEFAULTS.daily, ...stored?.daily },
      weekly: { ...PERIODIC_NOTES_DEFAULTS.weekly, ...stored?.weekly },
      monthly: { ...PERIODIC_NOTES_DEFAULTS.monthly, ...stored?.monthly }
    };
  }
);

if (browser) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  currentTheme.subscribe((theme) => {
    if (theme === 'system') {
      applyTheme('system');
    }
  });

  mediaQuery.addEventListener('change', () => {
    let currentValue: string = 'system';
    const unsub = currentTheme.subscribe((v) => {
      currentValue = v;
    });
    unsub();
    if (currentValue === 'system') {
      applyTheme('system');
    }
  });
}
