/**
 * Date formatting for re/notes: timestamps in the user's date and time format,
 * and the title a new note starts with.
 */

import { formatTimeOfDay } from '@reborn/i18n/config';
import { containsRtlText } from '@reborn/i18n/direction';
import { formatDateWithSetting } from '@reborn/utils';

/** U+200E, an invisible character with left-to-right direction. */
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e);

/**
 * Date and time of a moment, as the apps show it to the signed-in user: the
 * date in the format from Settings > Appearance, the time of day on the 12h /
 * 24h clock from the same card. Example: "2026-04-05, 14:32" or, on the 12h
 * clock, "2026-04-05, 2:32 PM" ("2:32 م" in Arabic: the language words the
 * AM/PM marker, the settings decide everything else).
 *
 * One formatter for every timestamp in re/notes: note cards and the note
 * itself, version history, the Archive, shares, sessions, backup and folder
 * sync (#595). Time is always shown, so notes created or modified on the same
 * day are distinguishable in the list (sort uses full-timestamp precision).
 *
 * The result is digits and punctuation, at most with a marker at the end.
 * After a label render it in `<bdi dir={$textDirection}>`; inside a translated
 * sentence pass it through `isolateInDirection` (guideline 74).
 */
export function formatSettingsDateTime(
  date: Date | string | number,
  dateFormatSetting: string,
  timeFormatSetting: string,
  locale: string | null | undefined
): string {
  const d = new Date(date);
  return `${formatDateWithSetting(d, dateFormatSetting)}, ${formatTimeOfDay(d, locale, timeFormatSetting)}`;
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
  timeFormatSetting: string,
  locale: string | null | undefined
): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = formatTimeOfDay(d, locale, timeFormatSetting);
  return sameDay ? time : `${formatDateWithSetting(d, dateFormatSetting)} ${time}`;
}
