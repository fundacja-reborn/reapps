import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LOCALES,
  LOCALE_WEEK_START,
  WEEK_START_PREFERENCES,
  isWeekStartPreference,
  resolveWeekStart,
  weekdayName
} from '../config';

/**
 * CLDR first day for a language tag, in `Date#getDay()` numbering. Node's ICU
 * carries the same CLDR data as `@internationalized/date` in the date picker.
 * `Intl.Locale#getWeekInfo` numbers days 1 = Monday ... 7 = Sunday.
 */
function cldrFirstDay(tag: string): number | null {
  const locale = new Intl.Locale(tag) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  const info = locale.getWeekInfo?.() ?? locale.weekInfo;
  return info ? info.firstDay % 7 : null;
}

describe('week start (#493)', () => {
  it('auto follows CLDR for every UI language except Arabic', () => {
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'ar') continue;
      const cldr = cldrFirstDay(locale);
      if (cldr === null) continue; // engine without week data
      expect(LOCALE_WEEK_START[locale], locale).toBe(cldr);
    }
  });

  it('auto for Arabic is Sunday, not the Saturday CLDR gives plain ar (Egypt)', () => {
    expect(resolveWeekStart('auto', 'ar')).toBe(0);
    const cldr = cldrFirstDay('ar');
    if (cldr !== null) expect(cldr).toBe(6);
  });

  it('auto resolves per language', () => {
    expect(resolveWeekStart('auto', 'en')).toBe(0);
    expect(resolveWeekStart('auto', 'pl')).toBe(1);
    expect(resolveWeekStart('auto', 'de')).toBe(1);
    expect(resolveWeekStart('auto', 'fr')).toBe(1);
    expect(resolveWeekStart('auto', 'es')).toBe(1);
  });

  it('a pinned day wins over the language', () => {
    expect(resolveWeekStart(6, 'pl')).toBe(6);
    expect(resolveWeekStart(0, 'pl')).toBe(0);
    expect(resolveWeekStart(1, 'en')).toBe(1);
    expect(resolveWeekStart(1, 'ar')).toBe(1);
  });

  it('a missing or unknown preference means auto', () => {
    expect(resolveWeekStart(undefined, 'pl')).toBe(1);
    expect(resolveWeekStart(null, 'en')).toBe(0);
    expect(resolveWeekStart(5, 'pl')).toBe(1); // Friday: not a choice in this build
    expect(resolveWeekStart('1', 'en')).toBe(0); // string, not the number
  });

  it('accepts a regional tag and falls back like the UI language', () => {
    expect(resolveWeekStart('auto', 'pl-PL')).toBe(1);
    expect(resolveWeekStart('auto', 'ar-u-nu-latn')).toBe(0);
    expect(resolveWeekStart('auto', 'xx')).toBe(LOCALE_WEEK_START.en);
    expect(resolveWeekStart('auto', undefined)).toBe(LOCALE_WEEK_START.en);
  });

  it('the guard accepts exactly the picker options', () => {
    for (const value of WEEK_START_PREFERENCES) expect(isWeekStartPreference(value)).toBe(true);
    for (const value of [undefined, null, 2, 5, '0', 'monday', 1.5]) {
      expect(isWeekStartPreference(value)).toBe(false);
    }
  });

  it('names weekdays in the app language, in their in-sentence form', () => {
    expect(weekdayName(0, 'en')).toBe('Sunday');
    expect(weekdayName(1, 'pl')).toBe('poniedziałek');
    expect(weekdayName(6, 'de')).toBe('Samstag');
    expect(weekdayName(0, 'fr')).toBe('dimanche');
    expect(weekdayName(0, 'ar')).toBe('الأحد');
    expect(weekdayName(7, 'en')).toBe('Sunday'); // wraps
    expect(weekdayName(1, 'en', 'short')).toBe('Mon');
  });
});
