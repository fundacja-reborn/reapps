/**
 * @reborn/i18n - Internationalization package for Reborn apps
 * 
 * This package provides a unified i18n solution for all Reborn applications,
 * supporting multiple languages and modular translations.
 */

// Core setup and configuration
export { 
  setupI18n, 
  isI18nInitialized,
  getAvailableLocales,
  changeLocale,
  locale,
  locales,
  loading,
  waitLocale,
  isLoading
} from './setup';

// Stores and utilities
export { t, json, formatDate, formatNumber, formatCurrency } from './stores';

// Configuration
export { 
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  TRANSLATION_MODULES,
  LOCALE_STORAGE_KEY,
  getBrowserLocale,
  saveLocalePreference,
  type SupportedLocale,
  type TranslationModule
} from './config';

// Re-export types from setup
export type { I18nOptions } from './setup';

// Release notes ("What's new") - curated, user-facing release history
export {
  RELEASE_NOTES,
  UPCOMING,
  compareVersions,
  getLatestReleaseVersion,
  hasUnseenReleaseNotes,
  selectReleases,
  selectUpcoming
} from './release-notes';
export { getReleaseNotes, getUpcoming } from './release-notes-api';
export type {
  ReleaseApp,
  ReleasePlatform,
  ReleaseCategory,
  ReleaseItem,
  ReleaseEntry,
  ReleaseNotesText,
  ReleaseFilter,
  LocalizedReleaseItem,
  LocalizedRelease,
  UpcomingItem,
  LocalizedUpcomingItem
} from './release-notes';
