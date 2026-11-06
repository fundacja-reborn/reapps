/**
 * Week date helpers.
 *
 * Start / end of a week that begins on any day (the user's first day of the
 * week, #493), plus ISO 8601 week numbering. ISO weeks start on Monday;
 * week 1 of a year is the week containing the first Thursday (equivalently:
 * the first week with 4+ days in the new year). Consequence: a calendar date
 * in late December may belong to W01 of the following year, and a date in
 * early January may belong to W52/W53 of the previous year. That is the
 * standard, not a bug. An ISO week number only describes a Monday-Sunday
 * week, so callers show it only when the week starts on Monday.
 */
import type { WeekStartDay } from '@reborn/i18n';

/**
 * First day (00:00:00 local time) of the week containing `date`, for weeks
 * starting on `weekStart` (`Date#getDay()` numbering: 0 = Sunday, 1 = Monday,
 * 6 = Saturday).
 */
export function getWeekStartDate(date: Date, weekStart: WeekStartDay): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Days since the week began: 0 on the first day, 6 on the last.
  const offset = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

/** Last day (00:00:00 local time) of the week containing `date`. */
export function getWeekEndDate(date: Date, weekStart: WeekStartDay): Date {
  const end = getWeekStartDate(date, weekStart);
  end.setDate(end.getDate() + 6);
  return end;
}

/** Monday (00:00:00 local time) of the ISO week containing `date`. */
export function getMondayOfWeek(date: Date): Date {
  return getWeekStartDate(date, 1);
}

/** Sunday (00:00:00 local time) of the ISO week containing `date`. */
export function getSundayOfWeek(date: Date): Date {
  return getWeekEndDate(date, 1);
}

/**
 * ISO 8601 week-numbering year and week number for `date`.
 * Canonical algorithm: Thursday of the date's week determines the year,
 * week 1 contains the first Thursday of the ISO year.
 */
export function getISOWeek(date: Date): { year: number; week: number } {
  // Work in UTC to avoid DST shifting the day of week.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to the Thursday of this ISO week (anchor for the year).
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

/** ISO week formatted as `YYYY-Www` (e.g. `2026-W19`). Pads single-digit weeks. */
export function formatISOWeek(date: Date): string {
  const { year, week } = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
