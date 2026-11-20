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

// ── Time of day: the user's 12h/24h setting (issues #376, #581) ────────
//
// Without `hourCycle` an `Intl` formatter takes the clock from the language:
// `en` and `ar` print "5:13 PM" / "5:13 م" to a user who chose 24h in
// Settings, and `pl` prints "17:13" to one who chose 12h. Every time of day
// the apps show goes through the helpers below, so the setting decides and
// the language only supplies the wording (date order, AM/PM marker).
// `ui-source-guards` in both apps fails on a time formatted any other way.

/**
 * `hourCycle` for the stored `timeFormat` setting. `'12h'` gives a 1-12 clock
 * with an AM/PM marker; anything else (`'24h'`, missing, a value a newer
 * client wrote) gives 00-23, the setting's default. `h23`, not `hour12:
 * false`: the latter lets some engines print midnight as "24:05".
 */
export function hourCycleFor(timeFormat: unknown): 'h12' | 'h23' {
  return timeFormat === '12h' ? 'h12' : 'h23';
}

/**
 * One formatter per language, clock and set of options. Building an
 * `Intl.DateTimeFormat` is the expensive part, and a list formats one time per
 * row (note cards, tasks). The apps use a handful of combinations, so the map
 * stays small.
 */
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * Date with time of day in the app language, the clock following the user's
 * `timeFormat` setting: "Nov 17, 2026, 17:13" / "17 lis 2026, 5:13 PM".
 *
 * `options` takes `dateStyle` / `timeStyle` or single fields; without a time
 * part in it `Intl` prints only the date, so keep one when overriding.
 */
export function formatDateTime(
  date: Date | string | number,
  locale: unknown,
  timeFormat: unknown,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  const tag = intlLocale(locale);
  const hourCycle = hourCycleFor(timeFormat);
  const key = `${tag}|${hourCycle}|${JSON.stringify(options)}`;
  let format = dateTimeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(tag, { ...options, hourCycle });
    dateTimeFormats.set(key, format);
  }
  return format.format(new Date(date));
}

/**
 * Time of day alone, in the app language and the user's clock: "17:13" /
 * "5:13 PM". `timeStyle: 'short'` keeps each language's own digits-per-hour
 * convention ("09:05" in Polish, "9:05" in Spanish).
 */
export function formatTimeOfDay(
  date: Date | string | number,
  locale: unknown,
  timeFormat: unknown
): string {
  return formatDateTime(date, locale, timeFormat, { timeStyle: 'short' });
}

// ── Hijri date next to the Gregorian one (issue #583) ──────────────────
//
// Display only: the apps store, sort and pick dates in the Gregorian calendar.
// The preference rides the shared settings bundle as `hijriDate`: 'off', or
// the number of days to move the calculated date by. The Islamic month starts
// with the sighting of the new moon, so the date announced in a country can
// be a day (rarely two) away from any calculated calendar; the adjustment
// lets the user match the local announcement. The base is Umm al-Qura, the
// calendar most devices and services show.

/** Days the calculated Hijri date is moved by. */
export type HijriAdjustment = -2 | -1 | 0 | 1 | 2;

/** The stored preference: not shown, or shown with this adjustment. */
export type HijriDatePreference = 'off' | HijriAdjustment;

/** Order of the options in the settings picker. */
export const HIJRI_DATE_PREFERENCES: readonly HijriDatePreference[] = ['off', 0, -1, 1, -2, 2];

/**
 * Runtime guard for a stored preference (IndexedDB, synced settings bundle).
 * Anything else - missing, or a value a newer client wrote - means `'off'`.
 */
export function isHijriDatePreference(value: unknown): value is HijriDatePreference {
  return (
    value === 'off' || value === -2 || value === -1 || value === 0 || value === 1 || value === 2
  );
}

/**
 * One Hijri formatter per language, or null where the browser has no Islamic
 * calendar. Building an `Intl.DateTimeFormat` is the expensive part, and the
 * note list formats one date per card.
 */
const hijriFormats = new Map<string, Intl.DateTimeFormat | null>();

function hijriFormat(locale: unknown): Intl.DateTimeFormat | null {
  const tag = intlLocale(locale);
  let format = hijriFormats.get(tag);
  if (format === undefined) {
    try {
      const candidate = new Intl.DateTimeFormat(tag, {
        calendar: 'islamic-umalqura',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      format = candidate.resolvedOptions().calendar.startsWith('islamic') ? candidate : null;
    } catch {
      format = null;
    }
    hijriFormats.set(tag, format);
  }
  return format;
}

/**
 * The Hijri (Umm al-Qura) date of `date` in the app language, moved by the
 * user's adjustment: "Jumada II 7, 1448 AH" / "7 Dżumada II 1448 AH". Null when
 * the preference is off or unknown, or the browser has no Islamic calendar.
 */
export function formatHijriDate(
  date: Date | string | number,
  locale: unknown,
  preference: unknown
): string | null {
  if (!isHijriDatePreference(preference) || preference === 'off') return null;
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return null;
  // Whole local days, so the time of day (and a DST change) cannot move it.
  day.setDate(day.getDate() + preference);
  return hijriFormat(locale)?.format(day) ?? null;
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
