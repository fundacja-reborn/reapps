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
import {
  isSupportedLocale,
  locale,
  resolveLocale,
  resolveWeekStart,
  type WeekStartPreference
} from '@reborn/i18n';
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
      // overriding (e.g. picked a different language on the login page) - push
      // that choice up so other devices converge.
      //
      // Only a synced locale this build ships may be overridden. An unknown
      // one was written by a newer client (a language added in a later
      // release): keep it and do not push, so the choice survives until this
      // device runs a build that supports it. The UI meanwhile stays on the
      // locale it already renders (setLocale below is a no-op for it).
      if (currentSettings) {
        const savedLocale = localStorage.getItem('preferred_language');
        if (
          isSupportedLocale(savedLocale) &&
          isSupportedLocale(currentSettings.language) &&
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

      // Apply language from IndexedDB so locale matches saved preference.
      // A locale this build does not ship (synced from a newer client) is a
      // no-op in setLocale - the stored value is kept untouched.
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
  // Eager init causes a race condition - see reborn-task for details.

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

/**
 * The language the UI actually renders in. The stored `language` setting is
 * synced across devices and apps, so it can hold a locale this build does not
 * ship (added in a later release); consumers (date formatting, the language
 * picker) then get the locale i18n is rendering instead of the raw value.
 */
export const currentLanguage = derived([appSettings, locale], ([$settings, $locale]) =>
  resolveLocale($settings?.language, $locale)
);

export const dateFormat = derived(
  appSettings,
  ($settings) => $settings?.dateFormat ?? 'YYYY-MM-DD'
);

export const timeFormat = derived(appSettings, ($settings) => $settings?.timeFormat ?? '24h');

/** The stored first-day-of-week choice (#493); absent means 'auto'. */
export const weekStartPreference = derived(
  appSettings,
  ($settings): WeekStartPreference => $settings?.weekStart ?? 'auto'
);

/**
 * The day the week starts on (0 = Sunday, 1 = Monday, 6 = Saturday): the
 * pinned day, or for 'auto' the one of the UI language (`resolveWeekStart`).
 * Every week-shaped view reads this, never the raw preference.
 */
export const weekStartsOn = derived([appSettings, currentLanguage], ([$settings, $language]) =>
  resolveWeekStart($settings?.weekStart, $language)
);

export const imageLoadMode = derived(appSettings, ($settings) => $settings?.imageLoadMode ?? 'ask');

export const editorMode = derived(appSettings, ($settings) => $settings?.editorMode ?? 'live');

export const folderSortMode = derived(
  appSettings,
  ($settings) => $settings?.folderSortMode ?? 'alphabetical'
);

/** Folder for "New note" outside a folder (#522); null = no folder. See `resolveNewNoteFolder`. */
export const newNoteFolderId = derived(
  appSettings,
  ($settings) => $settings?.newNoteFolderId ?? null
);

/**
 * Per-note, ephemeral override of the editor mode (live preview vs. markdown
 * source). `null` means "use the synced default from `editorMode`".
 *
 * Set by the in-note header mode menu and reset to `null` whenever the open
 * note changes (see `+page.svelte`). It is deliberately NOT persisted or
 * synced: switching a single note to raw markdown stays local to that note and
 * self-heals on reopen, instead of silently flipping the mode for every note.
 * A persistent preference belongs in Settings > Behavior (the `editorMode`
 * field above).
 */
export const editorModeOverride = writable<'live' | 'markdown' | null>(null);

/**
 * The editor mode actually applied to the open note: the per-note override when
 * present, otherwise the synced default. This is what the editor and find-in-note
 * read; `editorMode` alone is only the default/baseline.
 */
export const effectiveEditorMode = derived(
  [editorMode, editorModeOverride],
  ([$editorMode, $override]) => $override ?? $editorMode
);

export const editorModeIntroSeen = derived(
  appSettings,
  ($settings) => $settings?.editorModeIntroSeen ?? false
);

/**
 * When true (default), deleting a single note shows a confirmation dialog.
 * When false, single-note deletes go straight to Trash. Synced across devices.
 * Falls back to `true` for settings rows written before this field existed.
 */
export const confirmBeforeDelete = derived(
  appSettings,
  ($settings) => $settings?.confirmBeforeDelete ?? true
);

/**
 * Keep extra blank lines between blocks as empty lines in Preview and in the
 * PDF export (issue #549). On unless the user turned it off; a settings row
 * without the field - and a shared note's reader, who has no row - gets `true`.
 * Synced across devices.
 */
export const preserveBlankLines = derived(
  appSettings,
  ($settings) => $settings?.preserveBlankLines ?? true
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
