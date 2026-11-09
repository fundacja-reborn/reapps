/**
 * Date formatting utilities for the notes list view.
 */

import { containsRtlText } from '@reborn/i18n/direction';
import { formatDateWithSetting } from '@reborn/utils';

/** U+200E, an invisible character with left-to-right direction. */
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e);

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
 * The title a new note starts with: the localized word for "note" plus today's
 * date in the user's date format, e.g. "Note 2026-11-06" or "Notatka 06.11.2026".
 *
 * The date is the local calendar day. `toISOString()` would give the UTC day,
 * which is yesterday for a note created just after midnight in Warsaw.
 *
 * After a right-to-left word the date gets a left-to-right mark in front of it
 * (issue #482). In "ملاحظة 2026-11-07" the Unicode bidi algorithm treats digits
 * that follow an Arabic letter as Arabic numbers (rule W2), and a hyphen does
 * not join Arabic numbers into one (rule W4 joins them only across `/`, `.`,
 * `,` and `:`). Each part of the date is then laid out on its own and the
 * title shows "07-11-2026". With the mark as the nearest strong character the
 * date stays one left-to-right number wherever the title appears: note list,
 * editor, tabs, exported file names. Search ignores the mark (`foldSearchText`).
 * Formats with `/` or `.` display correctly without it; the mark does not
 * change them, and one rule for every format is easier to reason about.
 */
export function defaultNoteTitle(
  translate: (key: string, options: { values: { date: string } }) => string,
  dateFormatSetting: string,
  now: Date = new Date()
): string {
  const date = formatDateWithSetting(now, dateFormatSetting);
  const title = translate('notes.default_title', { values: { date } });
  const at = title.indexOf(date);
  if (at <= 0 || !containsRtlText(title.slice(0, at))) return title;
  return title.slice(0, at) + LEFT_TO_RIGHT_MARK + title.slice(at);
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
