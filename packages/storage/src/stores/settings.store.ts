import { IndexedDBStore } from '../core/store';
import { createLogger } from '@reborn/utils';

const logger = createLogger('SettingsStore');

/**
 * Application settings type (device-specific, not synced)
 */
export type ImageLoadMode = 'ask' | 'always' | 'never';
export type EditorMode = 'markdown' | 'live';

export interface AppSettings {
  id: string;
  app_name: 'reborn-task' | 'reborn-notes'; // Identyfikator aplikacji
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'pl' | 'de' | 'es' | 'fr';
  dateFormat: string;
  timeFormat: '12h' | '24h';
  firstDayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  notifications_enabled: boolean;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  imageLoadMode: ImageLoadMode;
  editorMode: EditorMode;
  created_at: string;
  updated_at: string;
}

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
          auto_sync_enabled: true,
          sync_interval_minutes: 5,
          imageLoadMode: 'ask',
          editorMode: 'markdown',
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
