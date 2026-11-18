import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LOCALES,
  formatDateTime,
  formatTimeOfDay,
  hourCycleFor,
  intlLocale
} from '../config';

/**
 * The 12h/24h setting decides the clock, not the language (issues #376, #581).
 * `ar` and `en` default to a 12-hour clock in CLDR: with 24h chosen in
 * Settings a note opened in Arabic still showed "5:13 م".
 */
describe('time of day follows the timeFormat setting', () => {
  // Local time, so the assertions hold in any time zone.
  const afternoon = new Date(2026, 10, 17, 17, 13, 5);
  const midnight = new Date(2026, 10, 17, 0, 5, 0);

  it('maps the stored setting to an hour cycle, 24h for anything unknown', () => {
    expect(hourCycleFor('12h')).toBe('h12');
    expect(hourCycleFor('24h')).toBe('h23');
    expect(hourCycleFor(undefined)).toBe('h23');
    expect(hourCycleFor(null)).toBe('h23');
    expect(hourCycleFor('h11')).toBe('h23');
  });

  it.each(SUPPORTED_LOCALES)('24h in %s: 17:13, no AM/PM marker', (locale) => {
    const dateTime = formatDateTime(afternoon, locale, '24h');
    expect(dateTime).toContain('17:13');
    expect(dateTime.endsWith('17:13')).toBe(true);
    expect(formatTimeOfDay(afternoon, locale, '24h')).toBe('17:13');
  });

  it.each(SUPPORTED_LOCALES)('12h in %s: 5:13 with a marker', (locale) => {
    const dateTime = formatDateTime(afternoon, locale, '12h');
    expect(dateTime).toMatch(/0?5:13/);
    expect(dateTime).not.toContain('17:13');
    // Something follows the minutes: PM, p. m., or the Arabic marker.
    expect(dateTime.endsWith('5:13')).toBe(false);
    expect(formatTimeOfDay(afternoon, locale, '12h')).toMatch(/^0?5:13\s\S+/);
  });

  it.each(SUPPORTED_LOCALES)('24h in %s: midnight is hour 0, never 24', (locale) => {
    expect(formatTimeOfDay(midnight, locale, '24h')).toMatch(/^0?0:05$/);
    expect(formatDateTime(midnight, locale, '24h')).not.toContain('24:05');
  });

  it('keeps the date wording of the language', () => {
    expect(formatDateTime(afternoon, 'en', '24h')).toBe('Nov 17, 2026, 17:13');
    expect(formatDateTime(afternoon, 'pl', '12h')).toMatch(/^17 lis 2026, 0?5:13 PM$/);
  });

  it('keeps Western digits for Arabic', () => {
    expect(formatDateTime(afternoon, 'ar', '24h')).toMatch(/2026/);
    expect(formatDateTime(afternoon, 'ar', '12h')).not.toMatch(/[\u{0660}-\u{0669}]/u);
  });

  it('accepts an ISO string and other styles, still with the chosen clock', () => {
    const iso = afternoon.toISOString();
    expect(formatDateTime(iso, 'en', '24h')).toBe('Nov 17, 2026, 17:13');
    expect(formatDateTime(afternoon, 'en', '24h', { dateStyle: 'short', timeStyle: 'short' })).toBe(
      '11/17/26, 17:13'
    );
    expect(
      formatDateTime(afternoon, 'en', '24h', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    ).toBe('Nov 17, 2026, 17:13');
  });

  it('falls back to the default language for an unsupported locale', () => {
    expect(formatDateTime(afternoon, 'xx', '24h')).toBe(
      new Intl.DateTimeFormat(intlLocale('xx'), {
        dateStyle: 'medium',
        timeStyle: 'short',
        hourCycle: 'h23'
      }).format(afternoon)
    );
  });
});
