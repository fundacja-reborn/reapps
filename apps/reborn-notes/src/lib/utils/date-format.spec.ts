import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldSearchText } from '@reborn/utils';
import { formatTimeOfDay } from '@reborn/i18n/config';
import { defaultNoteTitle, formatSettingsDateTime, formatSyncTimestamp } from './date-format';

/** Stands in for `$t`: shows which key was asked for and with which date. */
const translate = (key: string, options: { values: { date: string } }) =>
  `${key}=${options.values.date}`;

/** `$t` with a real template, as `notes.default_title` reads in a locale. */
const translateWith = (template: string) => (_key: string, options: { values: { date: string } }) =>
  template.replace('{date}', options.values.date);

const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e);

describe('defaultNoteTitle', () => {
  const day = new Date(2026, 10, 6, 12, 0);

  it('builds the title from the translated key, so no locale falls back to English', () => {
    expect(defaultNoteTitle(translate, 'YYYY-MM-DD', day)).toBe('notes.default_title=2026-11-06');
  });

  it.each([
    ['DD/MM/YYYY', '06/11/2026'],
    ['DD.MM.YYYY', '06.11.2026'],
    ['MM/DD/YYYY', '11/06/2026'],
    ['YYYY-MM-DD', '2026-11-06'],
    ['YYYY/MM/DD', '2026/11/06'],
    ['YYYY.MM.DD', '2026.11.06']
  ])('honors the %s date format setting', (format, expected) => {
    expect(defaultNoteTitle(translate, format, day)).toBe(`notes.default_title=${expected}`);
  });

  it('uses the local calendar day, which toISOString() gets wrong around midnight', () => {
    const justAfterMidnight = new Date(2026, 10, 6, 0, 30);
    expect(defaultNoteTitle(translate, 'YYYY-MM-DD', justAfterMidnight)).toBe(
      'notes.default_title=2026-11-06'
    );

    const justBeforeMidnight = new Date(2026, 10, 6, 23, 30);
    expect(defaultNoteTitle(translate, 'YYYY-MM-DD', justBeforeMidnight)).toBe(
      'notes.default_title=2026-11-06'
    );
  });

  describe('after a right-to-left word (#482)', () => {
    const arabic = translateWith('ملاحظة {date}');

    it.each([
      ['YYYY-MM-DD', '2026-11-06'],
      ['DD/MM/YYYY', '06/11/2026'],
      ['DD.MM.YYYY', '06.11.2026'],
      ['MM/DD/YYYY', '11/06/2026'],
      ['YYYY/MM/DD', '2026/11/06'],
      ['YYYY.MM.DD', '2026.11.06']
    ])('puts a left-to-right mark before the %s date', (format, expected) => {
      expect(defaultNoteTitle(arabic, format, day)).toBe(`ملاحظة ${LEFT_TO_RIGHT_MARK}${expected}`);
    });

    it('leaves left-to-right titles alone', () => {
      for (const template of ['Note {date}', 'Notatka {date}', 'Notiz {date}']) {
        expect(defaultNoteTitle(translateWith(template), 'YYYY-MM-DD', day)).toBe(
          template.replace('{date}', '2026-11-06')
        );
      }
    });

    it('leaves a title alone when the date comes first', () => {
      expect(defaultNoteTitle(translateWith('{date} ملاحظة'), 'YYYY-MM-DD', day)).toBe(
        '2026-11-06 ملاحظة'
      );
    });

    it('still finds the note when the search has no mark', () => {
      const title = defaultNoteTitle(arabic, 'YYYY-MM-DD', day);
      expect(foldSearchText(title)).toContain(foldSearchText('ملاحظة 2026-11-06'));
    });
  });
});

describe('formatSettingsDateTime', () => {
  // Local time, written without a zone: the same wall clock on every machine.
  const afternoon = '2026-11-06T17:13:00';
  const morning = '2026-11-06T09:05:00';

  it.each([
    ['DD/MM/YYYY', '06/11/2026'],
    ['DD.MM.YYYY', '06.11.2026'],
    ['MM/DD/YYYY', '11/06/2026'],
    ['YYYY-MM-DD', '2026-11-06'],
    ['YYYY/MM/DD', '2026/11/06'],
    ['YYYY.MM.DD', '2026.11.06']
  ])('puts the date in the %s format before the time', (format, expected) => {
    expect(formatSettingsDateTime(afternoon, format, '24h', 'en')).toBe(`${expected}, 17:13`);
    expect(formatSettingsDateTime(afternoon, format, '12h', 'en')).toMatch(
      new RegExp(`^${expected.replaceAll('.', '\\.')}, 5:13\\sPM$`)
    );
  });

  it.each(['en', 'pl', 'de', 'fr', 'es', 'ar'])(
    'takes the date from the setting, never from %s (#595)',
    (locale) => {
      for (const clock of ['24h', '12h']) {
        const shown = formatSettingsDateTime(afternoon, 'YYYY-MM-DD', clock, locale);
        expect(shown).toBe(`2026-11-06, ${formatTimeOfDay(afternoon, locale, clock)}`);
      }
    }
  );

  it('follows the clock from the setting, not the one of the language', () => {
    expect(formatSettingsDateTime(morning, 'YYYY-MM-DD', '24h', 'en')).toBe('2026-11-06, 09:05');
    // Polish pads the hour on the 12h clock: "05:13 PM".
    expect(formatSettingsDateTime(afternoon, 'YYYY-MM-DD', '12h', 'pl')).toMatch(
      /^2026-11-06, 0?5:13\sPM$/
    );
    expect(formatSettingsDateTime(afternoon, 'YYYY-MM-DD', 'something-new', 'en')).toBe(
      '2026-11-06, 17:13'
    );
  });

  it('words the AM/PM marker in the app language', () => {
    const arabic = formatSettingsDateTime(afternoon, 'YYYY/MM/DD', '12h', 'ar');
    expect(arabic.startsWith('2026/11/06, 5:13')).toBe(true);
    expect(arabic).toContain('م');
    expect(arabic).not.toContain('PM');
    expect(formatSettingsDateTime(afternoon, 'YYYY/MM/DD', '24h', 'ar')).toBe('2026/11/06, 17:13');
  });

  it('prints digits 0-9 in Arabic', () => {
    expect(formatSettingsDateTime(afternoon, 'DD/MM/YYYY', '12h', 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('formats before the language is loaded', () => {
    for (const locale of [null, undefined]) {
      expect(formatSettingsDateTime(afternoon, 'YYYY-MM-DD', '24h', locale)).toBe('2026-11-06, 17:13');
    }
  });

  it('takes a Date and a timestamp as well as an ISO string', () => {
    const date = new Date(2026, 10, 6, 17, 13);
    expect(formatSettingsDateTime(date, 'DD.MM.YYYY', '24h', 'pl')).toBe('06.11.2026, 17:13');
    expect(formatSettingsDateTime(date.getTime(), 'DD.MM.YYYY', '24h', 'pl')).toBe('06.11.2026, 17:13');
  });
});

describe('formatSyncTimestamp', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the time alone for a sync earlier today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 6, 18, 0));
    const synced = new Date(2026, 10, 6, 17, 13).toISOString();
    expect(formatSyncTimestamp(synced, 'YYYY-MM-DD', '24h', 'en')).toBe('17:13');
    expect(formatSyncTimestamp(synced, 'YYYY-MM-DD', '12h', 'ar')).toBe(
      formatTimeOfDay(synced, 'ar', '12h')
    );
  });

  it('adds the date in the format from the setting for an earlier day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 9, 0));
    const synced = new Date(2026, 10, 6, 17, 13).toISOString();
    expect(formatSyncTimestamp(synced, 'DD.MM.YYYY', '24h', 'pl')).toBe('06.11.2026 17:13');
    expect(formatSyncTimestamp(synced, 'YYYY/MM/DD', '24h', 'ar')).toBe('2026/11/06 17:13');
  });
});
