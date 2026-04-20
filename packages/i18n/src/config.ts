/**
 * Configuration for i18n package
 */

export const SUPPORTED_LOCALES = ['en', 'pl', 'de', 'es', 'fr'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français'
};

/**
 * Available translation modules
 */
export const TRANSLATION_MODULES = ['common', 'tasks', 'notes'] as const;
export type TranslationModule = typeof TRANSLATION_MODULES[number];

/**
 * Storage key for user's language preference
 */
export const LOCALE_STORAGE_KEY = 'preferred_language';

/**
 * Get browser locale or fallback to default
 */
export function getBrowserLocale(): SupportedLocale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY) as SupportedLocale;
  if (storedLocale && SUPPORTED_LOCALES.includes(storedLocale)) {
    return storedLocale;
  }

  const browserLocale = navigator.language?.split('-')[0] as SupportedLocale;
  if (browserLocale && SUPPORTED_LOCALES.includes(browserLocale)) {
    return browserLocale;
  }

  return DEFAULT_LOCALE;
}

/**
 * Save locale preference
 */
export function saveLocalePreference(locale: SupportedLocale): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}
