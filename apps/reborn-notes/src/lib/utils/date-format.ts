/**
 * Date formatting utilities for the notes list view.
 */

import { formatDateWithSetting } from '@reborn/utils';

/**
 * Format the time-of-day of a Date, honoring the user's 12h/24h preference.
 * Mirrors the manual formatting in VersionHistorySheet so a 24h user never
 * sees a locale-driven "01:05 PM" (issue #376). Examples: "13:05" / "1:05 PM".
 */
export function formatTimeWithSetting(d: Date, timeFormatSetting: string): string {
  if (timeFormatSetting === '12h') {
    const hours12 = d.getHours() % 12 || 12;
    const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${hours12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Format an ISO date string as date + time using the user's preferred formats.
 * Example: "2026-04-05, 14:32" (24h) or "2026-04-05, 2:32 PM" (12h).
 *
 * Time is always shown so that notes created/modified on the same day are
 * visibly distinguishable in the list (sort uses full-timestamp precision).
 */
export function formatNoteDate(
  iso: string,
  dateFormatSetting: string,
  timeFormatSetting = '24h'
): string {
  const d = new Date(iso);
  const dateStr = formatDateWithSetting(d, dateFormatSetting);
  return `${dateStr}, ${formatTimeWithSetting(d, timeFormatSetting)}`;
}

/**
 * Format a "last synced" timestamp for the compact sidebar footer.
 * Same calendar day -> time only; an earlier day -> date + time. Honors both
 * the time-format and date-format settings (issue #376).
 */
export function formatSyncTimestamp(
  iso: string,
  dateFormatSetting: string,
  timeFormatSetting: string
): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = formatTimeWithSetting(d, timeFormatSetting);
  return sameDay ? time : `${formatDateWithSetting(d, dateFormatSetting)} ${time}`;
}
