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

// ── First day of the week (issue #493) ─────────────────────────────────
//
// The user's preference rides the shared settings bundle as `weekStart`:
// 'auto' follows the UI language, or the user pins Saturday, Sunday or
// Monday (the conventions CLDR knows, Friday on the Maldives aside). Days use
// the `Date#getDay()` numbering - 0 = Sunday ... 6 = Saturday - which is also
// what the date picker's `weekStartsOn` takes. Lives here, in the
// dependency-free module, so pure helpers and their Node tests can import it.

/** A day a week can start on, in `Date#getDay()` numbering. */
export type WeekStartDay = 0 | 1 | 6;

/** The stored preference: follow the UI language, or a pinned day. */
export type WeekStartPreference = 'auto' | WeekStartDay;

/** Order of the options in the settings picker. */
export const WEEK_START_PREFERENCES: readonly WeekStartPreference[] = ['auto', 6, 0, 1];

/**
 * What `'auto'` resolves to per UI language: CLDR's first day for the
 * language without a region (what the date picker showed before the setting
 * existed), with one exception. CLDR reads plain `ar` as Egypt, which starts
 * on Saturday, but most Arabic-speaking countries start on Sunday (#493), so
 * `ar` is pinned to Sunday. The language carries no country and we do not
 * guess one from the device: for Egypt and Algeria CLDR disagrees with
 * practice anyway - that is what the manual choice is for.
 *
 * A new locale without an entry fails svelte-check; week-start.spec.ts
 * (packages/i18n) compares the table against the CLDR data in Node.
 */
export const LOCALE_WEEK_START: Record<SupportedLocale, WeekStartDay> = {
  en: 0,
  pl: 1,
  de: 1,
  es: 1,
  fr: 1,
  ar: 0
};

/**
 * Runtime guard for a stored preference (IndexedDB, synced settings bundle).
 * Anything else - missing, or a value a newer client wrote - means `'auto'`.
 */
export function isWeekStartPreference(value: unknown): value is WeekStartPreference {
  return value === 'auto' || value === 0 || value === 1 || value === 6;
}

/**
 * The day the week starts on for `preference` and the UI `locale`. A pinned
 * day wins; `'auto'`, a missing value or an unknown one follow the language.
 * `locale` may carry a region (`pl-PL`); an unsupported one falls back the
 * same way the UI language does.
 */
export function resolveWeekStart(preference: unknown, locale: unknown): WeekStartDay {
  if (preference === 0 || preference === 1 || preference === 6) return preference;
  const language = typeof locale === 'string' ? locale.split('-')[0] : locale;
  return LOCALE_WEEK_START[resolveLocale(language)];
}

/**
 * Name of weekday `day` (`Date#getDay()` numbering) in the app language, in
 * the form it takes inside a sentence ("Sunday", "niedziela", "dimanche").
 */
export function weekdayName(
  day: number,
  locale: unknown,
  width: 'long' | 'short' = 'long'
): string {
  // 2026-11-01 is a Sunday; local noon keeps DST shifts off the date.
  const date = new Date(2026, 10, 1 + (((day % 7) + 7) % 7), 12);
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: width }).format(date);
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
