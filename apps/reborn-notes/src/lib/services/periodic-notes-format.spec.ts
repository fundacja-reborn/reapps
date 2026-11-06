import { describe, it, expect } from 'vitest';
import { SUPPORTED_LOCALES, type WeekStartDay } from '@reborn/i18n/config';
import { PERIODIC_NOTES_DEFAULT_FORMATS, type PeriodicKind } from '@reborn/storage';
import {
  PERIODIC_FORMAT_PRESETS,
  formatName,
  formatRange,
  getAnchorDate,
  getAnchorIso,
  buildPeriodicTitle,
  periodicCandidateMatcher,
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


describe('PERIODIC_FORMAT_PRESETS', () => {
  it('lists the default format of each kind first', () => {
    for (const kind of ['daily', 'weekly', 'monthly'] as const) {
      expect(PERIODIC_FORMAT_PRESETS[kind][0]).toBe(PERIODIC_NOTES_DEFAULT_FORMATS[kind]);
    }
  });
});

describe('periodicCandidateMatcher - presets without a leading ISO date', () => {
  const NOVEMBER_2026 = new Date(2026, 10, 1);

  it('monthly: finds "MMMM YYYY" and "YYYY MMMM" titles of the month, in every language', () => {
    const isCandidate = periodicCandidateMatcher(
      'monthly',
      ['2026-11-01'],
      PERIODIC_FORMAT_PRESETS.monthly,
      SUPPORTED_LOCALES
    );
    expect(isCandidate('November 2026')).toBe(true);
    expect(isCandidate('2026 November')).toBe(true);
    expect(isCandidate(formatName(NOVEMBER_2026, 'MMMM YYYY', 'pl'))).toBe(true);
    expect(isCandidate(formatName(NOVEMBER_2026, 'YYYY MMMM', 'ar'))).toBe(true);
    // ISO titles keep matching by prefix.
    expect(isCandidate('2026-11')).toBe(true);
    expect(isCandidate('2026-11 plan')).toBe(true);
    // Other months and plain notes are not candidates.
    expect(isCandidate('October 2026')).toBe(false);
    expect(isCandidate('November 2025')).toBe(false);
    expect(isCandidate('2026-10')).toBe(false);
    expect(isCandidate('Shopping list')).toBe(false);
  });

  it('weekly: finds "YYYY-[W]ww" and "[Week] ww, YYYY" titles of the week', () => {
    const thursday = new Date(2026, 10, 5);
    const isCandidate = periodicCandidateMatcher(
      'weekly',
      [getAnchorIso('weekly', thursday), ...weekAnchorsContaining(thursday)],
      PERIODIC_FORMAT_PRESETS.weekly,
      SUPPORTED_LOCALES
    );
    expect(isCandidate('2026-W45')).toBe(true);
    expect(isCandidate('Week 45, 2026')).toBe(true);
    expect(isCandidate('2026-11-02 W45')).toBe(true);
    // A Sunday week covering the same Thursday (#493).
    expect(isCandidate('2026-11-01 – 2026-11-07')).toBe(true);
    expect(isCandidate('2026-W44')).toBe(false);
    expect(isCandidate('Week 46, 2026')).toBe(false);
  });

  it('daily: finds "dddd, D MMMM YYYY" titles of the day only', () => {
    const isCandidate = periodicCandidateMatcher(
      'daily',
      ['2026-11-06'],
      PERIODIC_FORMAT_PRESETS.daily,
      SUPPORTED_LOCALES
    );
    expect(isCandidate('Friday, 6 November 2026')).toBe(true);
    expect(isCandidate('Thursday, 5 November 2026')).toBe(false);
  });

  it('also finds titles of a stored format that is not a preset', () => {
    const anchors = ['2026-11-02'];
    const withFormat = periodicCandidateMatcher(
      'weekly',
      anchors,
      [...PERIODIC_FORMAT_PRESETS.weekly, '[KW] ww YYYY'],
      SUPPORTED_LOCALES
    );
    const presetsOnly = periodicCandidateMatcher(
      'weekly',
      anchors,
      PERIODIC_FORMAT_PRESETS.weekly,
      SUPPORTED_LOCALES
    );
    expect(withFormat('KW 45 2026')).toBe(true);
    expect(presetsOnly('KW 45 2026')).toBe(false);
  });

  // The bug this guards: a title the one-click flow created must be found by the
  // next click, or every click creates another note. Covers every preset, every
  // language, every first day of the week, and the format or the language
  // changing between the two clicks.
  it('every title the one-click flow creates is a candidate on the next click', () => {
    const clicks = [
      new Date(2026, 10, 6, 9), // Friday
      new Date(2026, 10, 1, 23), // Sunday
      new Date(2026, 10, 7, 0, 5), // Saturday
      new Date(2026, 11, 31, 12), // year end
      new Date(2027, 0, 1, 12) // year start
    ];
    const kinds: PeriodicKind[] = ['daily', 'weekly', 'monthly'];
    const weekStarts: WeekStartDay[] = [0, 1, 6];
    for (const kind of kinds) {
      for (const weekStart of weekStarts) {
        for (const now of clicks) {
          const anchorIso = getAnchorIso(kind, now, weekStart);
          const covering = kind === 'weekly' ? weekAnchorsContaining(now) : [];
          const isCandidate = periodicCandidateMatcher(
            kind,
            [anchorIso, ...covering],
            PERIODIC_FORMAT_PRESETS[kind],
            SUPPORTED_LOCALES
          );
          for (const format of PERIODIC_FORMAT_PRESETS[kind]) {
            for (const locale of SUPPORTED_LOCALES) {
              const title = buildPeriodicTitle(
                kind,
                now,
                format,
                PERIODIC_NOTES_DEFAULT_FORMATS[kind],
                locale,
                weekStart
              );
              expect(
                isCandidate(title),
                `${kind} ${format} ${locale} weekStart=${weekStart} ${anchorIso}: "${title}"`
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});
