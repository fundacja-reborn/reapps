import { IndexedDBStore } from '../core/store';
import { createLogger } from '@reborn/utils';

const logger = createLogger('SettingsStore');

/**
 * Application settings type (device-specific, not synced)
 */
export type ImageLoadMode = 'ask' | 'always' | 'never';
export type EditorMode = 'markdown' | 'live';
export type FolderSortMode = 'alphabetical' | 'custom';

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
  /** Must equal SupportedLocale from @reborn/i18n (no dependency from here):
   *  enforced at compile time by apps/reborn-notes/src/lib/supported-locales.regression.spec.ts. */
  language: 'en' | 'pl' | 'de' | 'es' | 'fr' | 'ar';
  dateFormat: string;
  timeFormat: '12h' | '24h';
  /**
   * @deprecated Never read and has no UI: every row holds the default `1`,
   * so a real choice cannot be told apart from it. Use `weekStart`. Kept in
   * the type and the shared bundle so older clients keep round-tripping it.
   */
  firstDayOfWeek: number;
  /**
   * First day of the week (issue #493): `'auto'` follows the UI language
   * (`resolveWeekStart` in @reborn/i18n), or a pinned day in `Date#getDay()`
   * numbering - 6 = Saturday, 0 = Sunday, 1 = Monday. Shared across both
   * apps through the shared settings bundle. Absent means `'auto'` and stays
   * absent until the user picks an option (defaults do not write it), so
   * only a real choice travels between devices.
   * Must equal WeekStartPreference from @reborn/i18n (no dependency from here):
   * enforced at compile time by apps/reborn-notes/src/lib/supported-locales.regression.spec.ts.
   */
  weekStart?: 'auto' | 0 | 1 | 6;
  notifications_enabled: boolean;
  /** Minutes before due_date to fire a reminder (only for tasks with has_time === true). */
  notification_lead_minutes: number;
  /** Local 'HH:MM' clock time to fire reminders for date-only tasks (has_time === false). */
  notification_all_day_time: string;
  /**
   * Opt-in to server-assisted background delivery. When ON, the client posts a
   * `(task_id, bucketed fire_at)` schedule to the server so Web Push wakes the
   * SW even with the app closed. When OFF, the server never learns `fire_at`
   * and notifications only fire while the tab is open (legacy SW-poll path).
   * The push payload is always a generic wake-up - task title/body are
   * decrypted inside the SW from local IndexedDB.
   */
  notification_background_delivery: boolean;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  imageLoadMode: ImageLoadMode;
  editorMode: EditorMode;
  editorModeIntroSeen: boolean;
  /**
   * When true, deleting a single note shows a confirmation dialog before moving
   * it to Trash. When false, single-note deletes go straight to Trash (which is
   * recoverable - notes are soft-deleted, never auto-purged). Default true.
   * Synced across devices: it's a caution preference, not a device trait. Bulk
   * deletes always confirm regardless of this flag.
   */
  confirmBeforeDelete: boolean;
  /**
   * Notes-only: sibling order of the folder tree. 'alphabetical' (default)
   * sorts by decrypted name client-side; 'custom' renders the user-arranged
   * `order_index` (drag between rows / move up-down), falling back to name
   * where a group was never rearranged. Synced across devices via the Notes
   * app bundle - the order_index values it renders sync through regular
   * folder sync anyway. Optional so reborn-task settings don't carry it.
   */
  folderSortMode?: FolderSortMode;
  /**
   * Notes-only: the folder a note made with "New note" goes to when no folder
   * is open (All notes, Starred, Tags, a smart folder, search) - issue #522.
   * Inside a folder the note goes there, as before. `null` = no folder (the
   * user cleared the choice; synced so the other devices clear it too),
   * absent = never chosen. A UUID of a folder, which the server only ever sees
   * inside the encrypted app bundle; a folder deleted since is treated as no
   * folder. Synced across devices via the Notes app bundle.
   */
  newNoteFolderId?: string | null;
  /**
   * Notes-only: keep extra blank lines between blocks as empty lines in
   * Preview and in the PDF export, instead of collapsing them the way plain
   * Markdown does (issue #549). Absent = on (the default): `initializeDefaults`
   * does not write it, so a fresh device never overwrites a choice made on
   * another one with a default, and a shared note's reader (no settings row)
   * gets the same rendering as a new user. Synced across devices via the Notes
   * app bundle - it is a reading preference, not a device trait.
   */
  preserveBlankLines?: boolean;
  /**
   * Notes-only: per-kind settings for Daily / Weekly / Monthly Notes (Obsidian-style).
   * Local & device-specific - not synced. Optional in the type so reborn-task settings
   * don't carry the field. Defaults are written by `initializeDefaults` for the notes app.
   */
  periodicNotes?: PeriodicNotesSettings;
  /**
   * Notes-only: the auto-backup recovery phrase, wrapped as its OWN AES-GCM
   * ciphertext under the master key (`cryptoManager.encryptText` output,
   * `iv:ciphertext`). NEVER plaintext: this row is stored unencrypted in
   * IndexedDB, so the phrase gets the same at-rest protection as note content
   * only through this inner envelope. Syncing it in the app bundle makes the
   * phrase ACCOUNT-scoped - it survives logout and reaches the user's other
   * devices as ciphertext the server cannot read (the wrapped-recovery-secret
   * pattern; see reborn-notes' auto-backup phrase-sync module). Absent until
   * the user enables auto-backup somewhere.
   *
   * `updatedAt` is the phrase's OWN freshness stamp: the settings bundle syncs
   * whole-row last-write-wins, so without it a device pushing an unrelated
   * setting from a stale row would silently revert the account's newest phrase
   * (breaking recoverability of every backup made since). Merge for this field
   * is newest-`updatedAt`-wins, independent of the row's `updated_at`.
   */
  autoBackupPhrase?: { wrapped: string; updatedAt: string };
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
          firstDayOfWeek: 1, // deprecated, see the field doc
          // No `weekStart`: absent means 'auto', and an absent key is left
          // out of the shared bundle, so a fresh device never overwrites a
          // day the user picked on another one with a default.
          notifications_enabled: false,
          notification_lead_minutes: 60,
          notification_all_day_time: '09:00',
          notification_background_delivery: true,
          auto_sync_enabled: true,
          sync_interval_minutes: 5,
          imageLoadMode: 'ask',
          editorMode: 'live',
          editorModeIntroSeen: false,
          confirmBeforeDelete: true,
          ...(appName === 'reborn-notes'
            ? {
                folderSortMode: 'alphabetical' as const,
                periodicNotes: structuredClone(PERIODIC_NOTES_DEFAULTS)
              }
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
    // An explicit reset is a choice of the defaults, so it has to reach the
    // other devices: write 'auto' instead of leaving the key absent (absent
    // stays out of the shared bundle and would keep their pinned day).
    await settingsOperations.setSetting(appName, 'weekStart', 'auto');
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
