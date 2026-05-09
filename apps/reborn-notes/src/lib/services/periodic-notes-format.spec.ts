import { describe, it, expect } from 'vitest';
import {
  formatName,
  formatRange,
  getAnchorDate,
  buildPeriodicTitle
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
