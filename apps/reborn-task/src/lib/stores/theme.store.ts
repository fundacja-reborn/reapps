import { appSettings, currentTheme } from './app-settings.store';
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';

const logger = createLogger('theme-store');

/**
 * @deprecated Use appSettings store instead
 * This store is kept for backward compatibility during migration
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * Legacy theme store - now derives from app settings
 * Provides backward compatibility for existing code
 */
function createThemeStore() {
  // Migrate from localStorage to app settings on first load
  if (browser) {
    const legacyTheme = localStorage.getItem('theme') as Theme;
    if (legacyTheme) {
      logger.info('Migrating theme from localStorage to app settings', { theme: legacyTheme });
      
      // Update app settings with legacy value
      appSettings.update('theme', legacyTheme).then(() => {
        // Remove from localStorage after successful migration
        localStorage.removeItem('theme');
        logger.info('Theme migration completed');
      }).catch(err => {
        logger.error('Failed to migrate theme', err);
      });
    }
  }

  // Subscribe to theme changes from app settings
  const { subscribe } = currentTheme;

  return {
    subscribe,
    set: (value: Theme) => {
      // Update through app settings
      appSettings.update('theme', value);
    },
    toggle: () => {
      // Toggle based on current visual state to avoid the system→light "no-op" click
      const isDark = browser && document.documentElement.classList.contains('dark');
      appSettings.update('theme', isDark ? 'light' : 'dark');
    },
    init: () => {
      // No-op - initialization is handled by app settings
      logger.debug('Theme init called - handled by app settings');
    }
  };
}

export const theme = createThemeStore();

export function toggleTheme() {
  theme.toggle();
}
