/**
 * Date formatting utilities for the notes list view.
 */

import { formatDateWithSetting } from '@reborn/utils';

/**
 * Format an ISO date string into a full date using the user's preferred format.
 * - Today → full date + time (e.g. "2026-04-05, 14:32")
 * - Older → full date only (e.g. "2026-04-05")
 *
 * No relative dates ("yesterday", short weekday) — always shows the explicit date.
 */
export function formatNoteDate(
  iso: string,
  dateFormatSetting: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future i18n use, caller passes $t
  _tFn?: (key: string) => string
): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const dateStr = formatDateWithSetting(d, dateFormatSetting);

  if (isToday) {
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr}, ${time}`;
  }

  return dateStr;
}
