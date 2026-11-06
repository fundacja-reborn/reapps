import { describe, expect, it } from 'vitest';
import { defaultNoteTitle } from './date-format';

/** Stands in for `$t`: shows which key was asked for and with which date. */
const translate = (key: string, options: { values: { date: string } }) =>
  `${key}=${options.values.date}`;

describe('defaultNoteTitle', () => {
  const day = new Date(2026, 10, 6, 12, 0);

  it('builds the title from the translated key, so no locale falls back to English', () => {
    expect(defaultNoteTitle(translate, 'YYYY-MM-DD', day)).toBe('notes.default_title=2026-11-06');
  });

  it.each([
    ['DD/MM/YYYY', '06/11/2026'],
    ['DD.MM.YYYY', '06.11.2026'],
    ['MM/DD/YYYY', '11/06/2026'],
    ['YYYY-MM-DD', '2026-11-06']
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
});
