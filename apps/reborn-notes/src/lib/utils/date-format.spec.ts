import { describe, expect, it } from 'vitest';
import { foldSearchText } from '@reborn/utils';
import { defaultNoteTitle } from './date-format';

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
