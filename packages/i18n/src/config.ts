/**
 * Configuration for i18n package.
 *
 * SUPPORTED_LOCALES is the single source of the locale list. Dependency-free
 * on purpose: server code imports it through the `@reborn/i18n/config`
 * subpath (no svelte-i18n / translation bundles), the service worker and the
 * server string tables type their maps as `Record<SupportedLocale, ...>` (so
 * a new locale without strings fails svelte-check), and the Node scripts read
 * the array from this file (scripts/supported-locales.mjs). Guarded by
 * src/__tests__/supported-locales.spec.ts.
 */

export const SUPPORTED_LOCALES = ['en', 'pl', 'de', 'es', 'fr', 'ar'] as const;
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

/**
 * BCP 47 tag for `Intl` formatters and `toLocale*String` (dates, times,
 * numbers, relative time) in the app's language. Every such call goes
 * through this helper, so dates follow the app language, not the device's.
 *
 * Arabic is pinned to Western digits 0-9, the convention agreed with the
 * translator (Arabic plan, D4): some engines and regional variants default
 * `ar` to Arabic-Indic digits. A regional tag of a supported language
 * (`pl-PL`) is kept; anything else becomes DEFAULT_LOCALE.
 */
export function intlLocale(locale: unknown): string {
  const tag =
    typeof locale === 'string' && isSupportedLocale(locale.split('-')[0]) ? locale : DEFAULT_LOCALE;
  return tag.split('-')[0] === 'ar' && !tag.includes('-u-') ? `${tag}-u-nu-latn` : tag;
}

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ar: 'العربية'
};

/**
 * Locales shipped as a beta: the translation is a draft still under review by
 * a native speaker (Arabic plan, decision D6). Language pickers mark them.
 */
export const BETA_LOCALES: readonly SupportedLocale[] = ['ar'];

/** A locale's name as a language picker shows it, with the beta marker. */
export function localeLabel(locale: SupportedLocale): string {
  const name = LOCALE_NAMES[locale];
  return BETA_LOCALES.includes(locale) ? `${name} (beta)` : name;
}

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
