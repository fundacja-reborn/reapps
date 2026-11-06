import { describe, it, expect } from 'vitest';
import {
  formatName,
  formatRange,
  getAnchorDate,
  getAnchorIso,
  buildPeriodicTitle,
  usesWeekNumber,
  weekRangeTitle,
  weekAnchorsContaining,
  choosePeriodicMatch
} from './periodic-notes-format';

const FRIDAY_2026_05_08 = new Date(2026, 4, 8);
const MONDAY_2026_05_04 = new Date(2026, 4, 4);

describe('formatName', () => {
  it('formats YYYY-MM-DD correctly', () => {
    expect(formatName(FRIDAY_2026_05_08, 'YYYY-MM-DD', 'en-US')).toBe('2026-05-08');
  });

  it('formats YYYY-MM correctly', () => {
    expect(formatName(FRIDAY_2026_05_08, 'YYYY-MM', 'en-US')).toBe('2026-05');
  });

  it('honors literal segments inside [...]', () => {
    // [W]ww with anchor date Friday 2026-05-08 → 2026-W19
    expect(formatName(FRIDAY_2026_05_08, 'YYYY-[W]ww', 'en-US')).toBe('2026-W19');
  });

  it('renders dddd as the full weekday in the requested locale', () => {
    expect(formatName(FRIDAY_2026_05_08, 'dddd', 'en-US')).toBe('Friday');
    expect(formatName(FRIDAY_2026_05_08, 'dddd', 'pl-PL')).toBe('piątek');
  });

  it('combines tokens — daily default format', () => {
    const en = formatName(FRIDAY_2026_05_08, 'YYYY-MM-DD dddd', 'en-US');
    expect(en).toBe('2026-05-08 Friday');
    const pl = formatName(FRIDAY_2026_05_08, 'YYYY-MM-DD dddd', 'pl-PL');
    expect(pl).toBe('2026-05-08 piątek');
  });

  it('combines tokens — weekly default format with Monday anchor', () => {
    expect(formatName(MONDAY_2026_05_04, 'YYYY-MM-DD [W]ww', 'en-US')).toBe('2026-05-04 W19');
  });

  it('uses two-digit week padding for ww and non-padded for w', () => {
    // First Monday of 2024 (W01)
    const monW01 = new Date(2024, 0, 1);
    expect(formatName(monW01, '[W]ww', 'en-US')).toBe('W01');
    expect(formatName(monW01, '[W]w', 'en-US')).toBe('W1');
  });

  it('renders YY (two-digit year)', () => {
    expect(formatName(FRIDAY_2026_05_08, 'YY-MM', 'en-US')).toBe('26-05');
  });

  it('renders MMMM and MMM', () => {
    expect(formatName(FRIDAY_2026_05_08, 'MMMM YYYY', 'en-US')).toBe('May 2026');
    expect(formatName(FRIDAY_2026_05_08, 'MMM', 'en-US')).toBe('May');
  });

  it('passes through unknown characters literally', () => {
    expect(formatName(FRIDAY_2026_05_08, 'YYYY/MM/DD', 'en-US')).toBe('2026/05/08');
  });

  it('handles unmatched [ by emitting it literally', () => {
    // No matching ']' — the '[' is emitted as-is, rest of the string still tokenized.
    expect(formatName(FRIDAY_2026_05_08, '[unclosed YYYY', 'en-US')).toBe('[unclosed 2026');
  });
});

describe('getAnchorDate', () => {
  it('returns today for daily', () => {
    const anchor = getAnchorDate('daily', FRIDAY_2026_05_08);
    expect(anchor.getFullYear()).toBe(2026);
    expect(anchor.getMonth()).toBe(4);
    expect(anchor.getDate()).toBe(8);
  });

  it('returns Monday-of-week for weekly when click is on Friday', () => {
    const anchor = getAnchorDate('weekly', FRIDAY_2026_05_08);
    expect(anchor.getDate()).toBe(4); // Mon 2026-05-04
  });

  it('returns first-of-month for monthly', () => {
    const anchor = getAnchorDate('monthly', FRIDAY_2026_05_08);
    expect(anchor.getDate()).toBe(1);
    expect(anchor.getMonth()).toBe(4);
  });
});

describe('formatRange', () => {
  it('builds daily range with weekday in locale', () => {
    expect(formatRange('daily', FRIDAY_2026_05_08, 'en-US')).toBe('2026-05-08 Friday');
    expect(formatRange('daily', FRIDAY_2026_05_08, 'pl-PL')).toBe('2026-05-08 piątek');
  });

  it('builds weekly range Mon-Sun within the same month (locale-native)', () => {
    // Week of Fri 2026-05-08 → Mon 4 .. Sun 10, both in May 2026.
    // Output formatting is delegated to Intl.formatRange per locale, which collapses
    // the shared month/year and uses the inflected month form where applicable.
    const en = formatRange('weekly', FRIDAY_2026_05_08, 'en-US');
    expect(en).toContain('May');
    expect(en).toContain('4');
    expect(en).toContain('10');
    expect(en).toContain('2026');

    const pl = formatRange('weekly', FRIDAY_2026_05_08, 'pl-PL');
    // Polish should use the genitive "maja" when paired with day numbers.
    expect(pl).toContain('maja');
    expect(pl).toContain('4');
    expect(pl).toContain('10');
    expect(pl).toContain('2026');
  });

  it('builds weekly range across a month boundary', () => {
    // Week of Wed 2026-04-29 → Mon 27 Apr .. Sun 3 May
    const wed = new Date(2026, 3, 29);
    const result = formatRange('weekly', wed, 'en-US');
    expect(result).toContain('April');
    expect(result).toContain('May');
    expect(result).toContain('27');
    expect(result).toContain('3');
    expect(result).toContain('2026');
  });

  it('builds monthly range', () => {
    expect(formatRange('monthly', FRIDAY_2026_05_08, 'en-US')).toBe('May 2026');
    expect(formatRange('monthly', FRIDAY_2026_05_08, 'pl-PL')).toBe('maj 2026');
  });
});

describe('buildPeriodicTitle', () => {
  it('uses the user format when valid', () => {
    expect(buildPeriodicTitle('daily', FRIDAY_2026_05_08, 'YYYY-MM-DD', 'YYYY-MM-DD', 'en-US')).toBe(
      '2026-05-08'
    );
  });

  it('falls back to defaultFormat when the user format produces an empty string', () => {
    // A format with only literals that all unwrap to nothing → empty.
    const result = buildPeriodicTitle('daily', FRIDAY_2026_05_08, '[]', 'YYYY-MM-DD', 'en-US');
    expect(result).toBe('2026-05-08');
  });

  it('anchors weekly to Monday regardless of click day', () => {
    const result = buildPeriodicTitle(
      'weekly',
      FRIDAY_2026_05_08,
      'YYYY-MM-DD [W]ww',
      'YYYY-MM-DD [W]ww',
      'en-US'
    );
    expect(result).toBe('2026-05-04 W19');
  });
});

describe('weekly notes - first day of the week (#493)', () => {
  // Thursday 2026-11-05.
  const THU = new Date(2026, 10, 5, 15, 30);
  const WEEKLY_DEFAULT = 'YYYY-MM-DD [W]ww';

  it('anchors on the first day of the user week', () => {
    expect(getAnchorIso('weekly', THU, 1)).toBe('2026-11-02');
    expect(getAnchorIso('weekly', THU, 0)).toBe('2026-11-01');
    expect(getAnchorIso('weekly', THU, 6)).toBe('2026-10-31');
    // Default stays the ISO Monday every note used before the setting.
    expect(getAnchorIso('weekly', THU)).toBe('2026-11-02');
  });

  it('daily and monthly ignore the week start', () => {
    expect(getAnchorIso('daily', THU, 0)).toBe('2026-11-05');
    expect(getAnchorIso('monthly', THU, 6)).toBe('2026-11-01');
  });

  it('Monday weeks keep the ISO week number title', () => {
    expect(buildPeriodicTitle('weekly', THU, WEEKLY_DEFAULT, WEEKLY_DEFAULT, 'en', 1)).toBe(
      '2026-11-02 W45'
    );
  });

  it('other weeks get the date range instead of a week number', () => {
    expect(buildPeriodicTitle('weekly', THU, WEEKLY_DEFAULT, WEEKLY_DEFAULT, 'ar', 0)).toBe(
      '2026-11-01 \u2013 2026-11-07'
    );
    expect(buildPeriodicTitle('weekly', THU, '[Week] ww, YYYY', WEEKLY_DEFAULT, 'en', 6)).toBe(
      '2026-10-31 \u2013 2026-11-06'
    );
  });

  it('a weekly format without a week number applies as it is', () => {
    expect(buildPeriodicTitle('weekly', THU, 'YYYY-MM-DD', WEEKLY_DEFAULT, 'en', 0)).toBe(
      '2026-11-01'
    );
  });

  it('the range title starts with the anchor (title-prefix lookups)', () => {
    const title = weekRangeTitle(getAnchorDate('weekly', THU, 6));
    expect(title.startsWith(getAnchorIso('weekly', THU, 6))).toBe(true);
  });

  it('detects week-number tokens outside literals only', () => {
    expect(usesWeekNumber('YYYY-MM-DD [W]ww')).toBe(true);
    expect(usesWeekNumber('[Week] w')).toBe(true);
    expect(usesWeekNumber('YYYY-MM-DD')).toBe(false);
    expect(usesWeekNumber('[Week] YYYY')).toBe(false);
    expect(usesWeekNumber('dddd')).toBe(false);
  });

  it('weekly range follows the week start', () => {
    expect(formatRange('weekly', THU, 'en', 0)).toBe(
      new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).formatRange(
        new Date(2026, 10, 1),
        new Date(2026, 10, 7)
      )
    );
  });

  it('weekAnchorsContaining lists today and the six days before, newest first', () => {
    expect(weekAnchorsContaining(THU)).toEqual([
      '2026-11-05',
      '2026-11-04',
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
      '2026-10-31',
      '2026-10-30'
    ]);
  });
});

describe('choosePeriodicMatch (#493)', () => {
  const THU = new Date(2026, 10, 5);
  const covering = weekAnchorsContaining(THU);

  it('prefers the note anchored exactly on the period, newest edit on duplicates', () => {
    const match = choosePeriodicMatch(
      [
        { id: 'monday-week', anchor: '2026-11-02', updatedAt: '2026-11-05T10:00:00Z' },
        { id: 'sunday-old', anchor: '2026-11-01', updatedAt: '2026-11-01T10:00:00Z' },
        { id: 'sunday-new', anchor: '2026-11-01', updatedAt: '2026-11-03T10:00:00Z' }
      ],
      '2026-11-01',
      covering
    );
    expect(match.exact).toBe('sunday-new');
  });

  it('switching Monday to Sunday mid-week keeps the week note', () => {
    // Sunday weeks now, but this week's note was made as a Monday week.
    const match = choosePeriodicMatch(
      [{ id: 'monday-week', anchor: '2026-11-02', updatedAt: '' }],
      '2026-11-01',
      covering
    );
    expect(match).toEqual({ exact: null, covering: 'monday-week' });
  });

  it('a week that has already ended does not cover today', () => {
    const match = choosePeriodicMatch(
      [{ id: 'last-week', anchor: '2026-10-26', updatedAt: '' }],
      '2026-11-01',
      covering
    );
    expect(match).toEqual({ exact: null, covering: null });
  });

  it('several covering weeks: the most recent start wins', () => {
    const match = choosePeriodicMatch(
      [
        { id: 'saturday-week', anchor: '2026-10-31', updatedAt: '2026-11-05T12:00:00Z' },
        { id: 'monday-week', anchor: '2026-11-02', updatedAt: '2026-11-02T12:00:00Z' }
      ],
      '2026-11-01',
      covering
    );
    expect(match.covering).toBe('monday-week');
  });

  it('without covering anchors (daily, monthly) only exact matches count', () => {
    const match = choosePeriodicMatch(
      [{ id: 'other-day', anchor: '2026-11-04', updatedAt: '' }],
      '2026-11-05'
    );
    expect(match).toEqual({ exact: null, covering: null });
  });
});

