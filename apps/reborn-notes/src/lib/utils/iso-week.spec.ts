import { describe, it, expect } from 'vitest';
import {
  getMondayOfWeek,
  getSundayOfWeek,
  getWeekStartDate,
  getWeekEndDate,
  getISOWeek,
  formatISOWeek
} from './iso-week';

/** Local `YYYY-MM-DD` of a date. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('getMondayOfWeek', () => {
  it('returns the same date when called on a Monday', () => {
    const monday = new Date(2026, 4, 4); // Mon 2026-05-04
    const result = getMondayOfWeek(monday);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4);
    expect(result.getDate()).toBe(4);
  });

  it('shifts back to Monday when called on a Sunday', () => {
    const sunday = new Date(2026, 4, 10); // Sun 2026-05-10
    const result = getMondayOfWeek(sunday);
    expect(result.getDate()).toBe(4);
    expect(result.getMonth()).toBe(4);
    expect(result.getFullYear()).toBe(2026);
  });

  it('shifts back to Monday when called on a Friday', () => {
    const friday = new Date(2026, 4, 8); // Fri 2026-05-08
    const result = getMondayOfWeek(friday);
    expect(result.getDate()).toBe(4);
  });

  it('crosses month boundary correctly', () => {
    // Sun 2026-03-01 → previous Monday is Mon 2026-02-23
    const sunday = new Date(2026, 2, 1);
    const result = getMondayOfWeek(sunday);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // Feb
    expect(result.getDate()).toBe(23);
  });

  it('crosses year boundary correctly', () => {
    // Sun 2026-01-04 → previous Monday is Mon 2025-12-29
    const sunday = new Date(2026, 0, 4);
    const result = getMondayOfWeek(sunday);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(11); // Dec
    expect(result.getDate()).toBe(29);
  });
});

describe('getSundayOfWeek', () => {
  it('returns Sunday for any day in the same ISO week', () => {
    const wed = new Date(2026, 4, 6); // Wed 2026-05-06
    const result = getSundayOfWeek(wed);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4);
    expect(result.getDate()).toBe(10); // Sun 2026-05-10
  });
});

describe('getISOWeek', () => {
  it('returns W19 for 2026-05-08 (Friday)', () => {
    const result = getISOWeek(new Date(2026, 4, 8));
    expect(result).toEqual({ year: 2026, week: 19 });
  });

  it('returns W02 for 2026-01-05 (Monday after W01 wraps from previous year)', () => {
    // 2026 starts Thursday, so W01 covers 2025-12-29 .. 2026-01-04. 2026-01-05 is W02.
    const result = getISOWeek(new Date(2026, 0, 5));
    expect(result).toEqual({ year: 2026, week: 2 });
  });

  // ── ISO week edge cases at year boundaries ──────────────────────

  it('puts 2025-01-01 (Wed) into 2025-W01', () => {
    // 2025-01-01 is a Wednesday → first Thursday of 2025 (Jan 2) is in W01
    const result = getISOWeek(new Date(2025, 0, 1));
    expect(result).toEqual({ year: 2025, week: 1 });
  });

  it('puts 2026-01-01 (Thu) into 2026-W01', () => {
    // Thursday Jan 1 → that week is W01 by definition
    const result = getISOWeek(new Date(2026, 0, 1));
    expect(result).toEqual({ year: 2026, week: 1 });
  });

  it('puts 2024-12-30 (Mon) into 2025-W01', () => {
    // Monday of the week containing Thu 2025-01-02 → ISO year rolls to 2025
    const result = getISOWeek(new Date(2024, 11, 30));
    expect(result).toEqual({ year: 2025, week: 1 });
  });

  it('puts 2025-12-29 (Mon) into 2026-W01', () => {
    // Monday of the week containing Thu 2026-01-01 → ISO year rolls to 2026
    const result = getISOWeek(new Date(2025, 11, 29));
    expect(result).toEqual({ year: 2026, week: 1 });
  });

  it('puts 2021-01-01 (Fri) into 2020-W53', () => {
    // 2020 has a 53rd ISO week (long year, started on Wednesday 2020-01-01)
    const result = getISOWeek(new Date(2021, 0, 1));
    expect(result).toEqual({ year: 2020, week: 53 });
  });

  it('puts 2027-01-03 (Sun) into 2026-W53', () => {
    // 2026 starts on Thu, so it has 53 ISO weeks; 2027-01-03 falls in W53
    const result = getISOWeek(new Date(2027, 0, 3));
    expect(result).toEqual({ year: 2026, week: 53 });
  });
});

describe('formatISOWeek', () => {
  it('zero-pads single-digit weeks', () => {
    // 2024-01-08 (Mon) → W02 of 2024 — pads to two digits
    expect(formatISOWeek(new Date(2024, 0, 8))).toBe('2024-W02');
    // 2025-01-01 (Wed) → W01 of 2025
    expect(formatISOWeek(new Date(2025, 0, 1))).toBe('2025-W01');
  });

  it('formats double-digit weeks without extra padding', () => {
    expect(formatISOWeek(new Date(2026, 4, 8))).toBe('2026-W19');
  });

  it('rolls the ISO year for late-December dates that belong to next year W01', () => {
    expect(formatISOWeek(new Date(2024, 11, 30))).toBe('2025-W01');
  });
});

describe('getWeekStartDate / getWeekEndDate - any first day (#493)', () => {
  // Thursday 2026-11-05.
  const thu = new Date(2026, 10, 5, 15, 30);

  it('Monday weeks: Mon 2 Nov - Sun 8 Nov', () => {
    expect(ymd(getWeekStartDate(thu, 1))).toBe('2026-11-02');
    expect(ymd(getWeekEndDate(thu, 1))).toBe('2026-11-08');
  });

  it('Sunday weeks: Sun 1 Nov - Sat 7 Nov', () => {
    expect(ymd(getWeekStartDate(thu, 0))).toBe('2026-11-01');
    expect(ymd(getWeekEndDate(thu, 0))).toBe('2026-11-07');
  });

  it('Saturday weeks: Sat 31 Oct - Fri 6 Nov (crosses the month)', () => {
    expect(ymd(getWeekStartDate(thu, 6))).toBe('2026-10-31');
    expect(ymd(getWeekEndDate(thu, 6))).toBe('2026-11-06');
  });

  it('the first day maps to itself, the day before it to the previous week', () => {
    const sat = new Date(2026, 10, 7);
    expect(ymd(getWeekStartDate(sat, 6))).toBe('2026-11-07');
    expect(ymd(getWeekStartDate(sat, 0))).toBe('2026-11-01');
    const sun = new Date(2026, 10, 8);
    expect(ymd(getWeekStartDate(sun, 0))).toBe('2026-11-08');
    expect(ymd(getWeekStartDate(sun, 1))).toBe('2026-11-02');
  });

  it('crosses the year boundary', () => {
    const newYear = new Date(2027, 0, 1); // Friday
    expect(ymd(getWeekStartDate(newYear, 0))).toBe('2026-12-27');
    expect(ymd(getWeekStartDate(newYear, 6))).toBe('2026-12-26');
    expect(ymd(getWeekEndDate(newYear, 6))).toBe('2027-01-01');
  });

  it('returns local midnight', () => {
    const start = getWeekStartDate(thu, 0);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });
});

