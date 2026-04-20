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
