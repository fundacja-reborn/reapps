import { IndexedDBStore } from '../core/store';
import type { UserSettings, SyncableEncryptedEntity } from '@reborn/types';

// Define UserSettingsEncrypted type locally since it's not in @reborn/types
export interface UserSettingsEncrypted extends SyncableEncryptedEntity {
  settings_encrypted: string; // JSON stringified UserSettings
}

/**
 * User settings store for storing encrypted user preferences and configuration
 * Note: UserSettingsEncrypted is defined locally as it's not in @reborn/types yet
 */
export const userStore = new IndexedDBStore<UserSettingsEncrypted>({
  storeName: 'userSettings',
  indexes: []
});

/**
 * Helper queries for user settings
 */
export const userQueries = {
  /**
   * Get current user settings
   * Since we typically have only one user settings record per device
   */
  getCurrentSettings: async (): Promise<UserSettingsEncrypted | null> => {
    const allSettings = await userStore.getAll();
    return allSettings[0] || null;
  },

  /**
   * Check if user settings exist
   */
  hasSettings: async (): Promise<boolean> => {
    const count = await userStore.count();
    return count > 0;
  }
};

/**
 * User settings operations
 */
export const userOperations = {
  /**
   * Initialize or update user settings
   */
  saveSettings: async (settings: UserSettingsEncrypted): Promise<void> => {
    await userStore.save(settings);
  },

  /**
   * Clear all user settings
   */
  clearSettings: async (): Promise<void> => {
    await userStore.clear();
  }
};
