/**
 * App-specific settings helper for RebornTask
 */
import { settingsQueries, settingsOperations } from '@reborn/storage';
import type { AppSettings } from '@reborn/storage';

const APP_NAME = 'reborn-task' as const;

/**
 * Get current settings for RebornTask
 */
export async function getSettings(): Promise<AppSettings | null> {
  return settingsQueries.getCurrentSettings(APP_NAME);
}

/**
 * Get a specific setting value for RebornTask
 */
export async function getSetting<K extends keyof Omit<AppSettings, 'app_name'>>(
  key: K
): Promise<AppSettings[K] | undefined> {
  return settingsQueries.getSetting(APP_NAME, key);
}

/**
 * Update settings for RebornTask
 */
export async function updateSettings(
  updates: Partial<Omit<AppSettings, 'app_name'>>
): Promise<void> {
  return settingsOperations.updateSettings(APP_NAME, updates);
}

/**
 * Update a single setting for RebornTask
 */
export async function setSetting<K extends keyof Omit<AppSettings, 'app_name'>>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  return settingsOperations.setSetting(APP_NAME, key, value);
}

/**
 * Initialize default settings for RebornTask
 */
export async function initializeSettings(): Promise<void> {
  return settingsOperations.initializeDefaults(APP_NAME);
}

/**
 * Reset to default settings for RebornTask
 */
export async function resetSettings(): Promise<void> {
  return settingsOperations.resetToDefaults(APP_NAME);
}
