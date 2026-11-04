/**
 * Configuration for i18n package
 */

export const SUPPORTED_LOCALES = ['en', 'pl', 'de', 'es', 'fr'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Runtime guard for locale values that come from outside the type system:
 * IndexedDB, E2E synced settings, localStorage, URL params.
 *
 * The `language` setting is synced across devices and apps, so a newer client
 * may write a locale this build does not ship (e.g. a language added in a
 * later release). Every read of a stored locale must go through this guard
 * instead of trusting the `SupportedLocale` type.
 */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve the locale the UI should actually use.
 *
 * Returns `preferred` when this build supports it, otherwise `current`
 * (typically the locale i18n is already rendering), otherwise
 * `DEFAULT_LOCALE`. An unsupported preference is never "corrected" here -
 * callers must not write the result back to storage, so the user's choice
 * survives until a build that supports it.
 */
export function resolveLocale(preferred: unknown, current?: unknown): SupportedLocale {
  if (isSupportedLocale(preferred)) return preferred;
  if (isSupportedLocale(current)) return current;
  return DEFAULT_LOCALE;
}

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
