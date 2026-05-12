import { IndexedDBStore } from '../core/store';
import { createLogger } from '@reborn/utils';

const logger = createLogger('SettingsStore');

/**
 * Application settings type (device-specific, not synced)
 */
export type ImageLoadMode = 'ask' | 'always' | 'never';
export type EditorMode = 'markdown' | 'live';

export type PeriodicKind = 'daily' | 'weekly' | 'monthly';

export interface PeriodicKindSettings {
  /** Show the corresponding button in the Notes navigation rail. */
  enabled: boolean;
  /** Folder ID where notes of this kind live. Null = not yet created (lazy). */
  folderId: string | null;
  /**
   * `Intl.DateTimeFormat` token string for the note title. Tokens supported:
   * `YYYY`, `YY`, `MM`, `MMMM`, `MMM`, `DD`, `D`, `dddd`, `ddd`, `[W]ww`,
   * `[W]w`, `ww`, `w`. Anything inside `[…]` is emitted literally.
   */
  format: string;
  /**
   * True after the user has dismissed the first-use onboarding modal for this
   * kind. Local & device-specific (lives in `app-settings`, not synced) so each
   * device gets its own onboarding the first time the kind is used there.
   */
  onboardingDismissed: boolean;
  /**
   * True after a one-time backfill of `metadata_encrypted.periodic` has run
   * for every existing note in this kind's folder. Scoped per-device because
   * settings aren't synced - each device runs its own backfill the first time
   * the kind is opened post-upgrade. Notes' encrypted metadata themselves DO
   * sync, so the second device usually finds nothing left to backfill.
   */
  metadataMigrated?: boolean;
}

export interface PeriodicNotesSettings {
  daily: PeriodicKindSettings;
  weekly: PeriodicKindSettings;
  monthly: PeriodicKindSettings;
}

export interface AppSettings {
  id: string;
  app_name: 'reborn-task' | 'reborn-notes'; // Identyfikator aplikacji
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'pl' | 'de' | 'es' | 'fr';
  dateFormat: string;
  timeFormat: '12h' | '24h';
  firstDayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  notifications_enabled: boolean;
  /** Minutes before due_date to fire a reminder (only for tasks with has_time === true). */
  notification_lead_minutes: number;
  /** Local 'HH:MM' clock time to fire reminders for date-only tasks (has_time === false). */
  notification_all_day_time: string;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  imageLoadMode: ImageLoadMode;
  editorMode: EditorMode;
  editorModeIntroSeen: boolean;
  /**
   * Notes-only: per-kind settings for Daily / Weekly / Monthly Notes (Obsidian-style).
   * Local & device-specific — not synced. Optional in the type so reborn-task settings
   * don't carry the field. Defaults are written by `initializeDefaults` for the notes app.
   */
  periodicNotes?: PeriodicNotesSettings;
  created_at: string;
  updated_at: string;
}

/** Default formats per kind. See guideline 57. */
export const PERIODIC_NOTES_DEFAULT_FORMATS: Record<PeriodicKind, string> = {
  daily: 'YYYY-MM-DD dddd',
  weekly: 'YYYY-MM-DD [W]ww',
  monthly: 'YYYY-MM'
};

/** Default visibility per kind: only Daily on by default. */
export const PERIODIC_NOTES_DEFAULTS: PeriodicNotesSettings = {
  daily: {
    enabled: true,
    folderId: null,
    format: PERIODIC_NOTES_DEFAULT_FORMATS.daily,
    onboardingDismissed: false,
    metadataMigrated: false
  },
  weekly: {
    enabled: false,
    folderId: null,
    format: PERIODIC_NOTES_DEFAULT_FORMATS.weekly,
    onboardingDismissed: false,
    metadataMigrated: false
  },
  monthly: {
    enabled: false,
    folderId: null,
    format: PERIODIC_NOTES_DEFAULT_FORMATS.monthly,
    onboardingDismissed: false
  }
};

/**
 * Application settings store (non-encrypted, device-specific settings)
 */
export const settingsStore = new IndexedDBStore<AppSettings>({
  storeName: 'appSettings', // Different from userSettings which is encrypted
  indexes: [
    { name: 'app_name', keyPath: 'app_name' } // Indeks dla szybkiego wyszukiwania per aplikacja
  ]
});

/**
 * Helper queries for app settings
 */
export const settingsQueries = {
  /**
   * Get current app settings for specific app
   */
  getCurrentSettings: async (appName: AppSettings['app_name']): Promise<AppSettings | null> => {
    const settings = await settingsStore.query('app_name', appName);
    return settings[0] || null;
  },

  /**
   * Get a specific setting value for app
   */
  getSetting: async <K extends keyof AppSettings>(
    appName: AppSettings['app_name'],
    key: K
  ): Promise<AppSettings[K] | undefined> => {
    const settings = await settingsQueries.getCurrentSettings(appName);
    return settings?.[key];
  },

  /**
   * Check if settings exist for app
   */
  hasSettings: async (appName: AppSettings['app_name']): Promise<boolean> => {
    try {
      const count = await settingsStore.countByIndex('app_name', appName);
      return count > 0;
    } catch (error) {
      // If the store doesn't exist yet or database is not initialized, return false
      logger.warn('Failed to check settings existence, assuming no settings exist', error);
      return false;
    }
  }
};

/**
 * App settings operations
 */
export const settingsOperations = {
  /**
   * Initialize default settings for specific app
   */
  initializeDefaults: async (appName: AppSettings['app_name']): Promise<void> => {
    try {
      const exists = await settingsQueries.hasSettings(appName);
      if (!exists) {
        const defaultSettings: AppSettings = {
          id: crypto.randomUUID(),
          app_name: appName,
          theme: 'system',
          language: 'pl',
          dateFormat: 'YYYY-MM-DD',
          timeFormat: '24h',
          firstDayOfWeek: 1, // Monday
          notifications_enabled: false,
          notification_lead_minutes: 60,
          notification_all_day_time: '09:00',
          auto_sync_enabled: true,
          sync_interval_minutes: 5,
          imageLoadMode: 'ask',
          editorMode: 'live',
          editorModeIntroSeen: false,
          ...(appName === 'reborn-notes'
            ? { periodicNotes: structuredClone(PERIODIC_NOTES_DEFAULTS) }
            : {}),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        await settingsStore.save(defaultSettings);
      }
    } catch (error) {
      logger.error('Failed to initialize default settings', { appName, error });
      // Don't throw - let the app continue without settings
    }
  },

  /**
   * Update settings for specific app
   */
  updateSettings: async (
    appName: AppSettings['app_name'],
    updates: Partial<Omit<AppSettings, 'app_name'>>
  ): Promise<void> => {
    const current = await settingsQueries.getCurrentSettings(appName);
    if (!current) {
      await settingsOperations.initializeDefaults(appName);
      const newCurrent = await settingsQueries.getCurrentSettings(appName);
      if (!newCurrent) throw new Error('Failed to initialize settings');

      await settingsStore.save({
        ...newCurrent,
        ...updates,
        updated_at: new Date().toISOString()
      });
    } else {
      await settingsStore.save({
        ...current,
        ...updates,
        updated_at: new Date().toISOString()
      });
    }
  },

  /**
   * Update a single setting for app
   */
  setSetting: async <K extends keyof Omit<AppSettings, 'app_name'>>(
    appName: AppSettings['app_name'],
    key: K,
    value: AppSettings[K]
  ): Promise<void> => {
    await settingsOperations.updateSettings(appName, { [key]: value } as Partial<
      Omit<AppSettings, 'app_name'>
    >);
  },

  /**
   * Reset to default settings for specific app
   */
  resetToDefaults: async (appName: AppSettings['app_name']): Promise<void> => {
    const current = await settingsQueries.getCurrentSettings(appName);
    if (current) {
      await settingsStore.delete(current.id);
    }
    await settingsOperations.initializeDefaults(appName);
  },

  /**
   * Clear settings for specific app
   */
  clearSettings: async (appName: AppSettings['app_name']): Promise<void> => {
    const current = await settingsQueries.getCurrentSettings(appName);
    if (current) {
      await settingsStore.delete(current.id);
    }
  },

  /**
   * Clear all settings for all apps
   */
  clearAllSettings: async (): Promise<void> => {
    await settingsStore.clear();
  }
};
