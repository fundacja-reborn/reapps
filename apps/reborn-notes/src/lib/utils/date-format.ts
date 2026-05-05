/**
 * Date formatting utilities for the notes list view.
 */

import { formatDateWithSetting } from '@reborn/utils';

/**
 * Format an ISO date string as date + time using the user's preferred date format.
 * Example: "2026-04-05, 14:32".
 *
 * Time is always shown so that notes created/modified on the same day are
 * visibly distinguishable in the list (sort uses full-timestamp precision).
 */
export function formatNoteDate(
  iso: string,
  dateFormatSetting: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future i18n use, caller passes $t
  _tFn?: (key: string) => string
): string {
  const d = new Date(iso);
  const dateStr = formatDateWithSetting(d, dateFormatSetting);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${time}`;
}
