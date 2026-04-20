/**
 * App-specific settings helper for RebornNotes
 */
import { settingsQueries, settingsOperations } from '@reborn/storage';
import type { AppSettings } from '@reborn/storage';

const APP_NAME = 'reborn-notes' as const;

/**
 * Get current settings for RebornNotes
 */
export async function getSettings(): Promise<AppSettings | null> {
  return settingsQueries.getCurrentSettings(APP_NAME);
}

/**
 * Get a specific setting value for RebornNotes
 */
export async function getSetting<K extends keyof Omit<AppSettings, 'app_name'>>(
  key: K
): Promise<AppSettings[K] | undefined> {
  return settingsQueries.getSetting(APP_NAME, key);
}

/**
 * Update settings for RebornNotes
 */
export async function updateSettings(
  updates: Partial<Omit<AppSettings, 'app_name'>>
): Promise<void> {
  return settingsOperations.updateSettings(APP_NAME, updates);
}

/**
 * Update a single setting for RebornNotes
 */
export async function setSetting<K extends keyof Omit<AppSettings, 'app_name'>>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  return settingsOperations.setSetting(APP_NAME, key, value);
}

/**
 * Initialize default settings for RebornNotes
 */
export async function initializeSettings(): Promise<void> {
  return settingsOperations.initializeDefaults(APP_NAME);
}

/**
 * Reset to default settings for RebornNotes
 */
export async function resetSettings(): Promise<void> {
  return settingsOperations.resetToDefaults(APP_NAME);
}
