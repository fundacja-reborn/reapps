/**
 * Available date formats for the application
 * Each format has a key (stored in DB) and display value (shown in UI)
 */
export const DATE_FORMATS = [
  { key: 'yyyy-MM-dd', label: '2024-01-31 (ISO)' },
  { key: 'dd/MM/yyyy', label: '31/01/2024' },
  { key: 'MM/dd/yyyy', label: '01/31/2024' },
  { key: 'd MMMM yyyy', label: '31 January 2024' }
] as const;

export type DateFormat = (typeof DATE_FORMATS)[number]['key'];

/**
 * Converts a local date to UTC for storage
 * Sets the time to noon UTC to avoid timezone issues
 */
export function toUTC(date: Date | string | null, hasTime = false): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;

  if (hasTime) {
    // If has time, preserve the exact time in UTC
    return d.toISOString();
  } else {
    // If no time, set to start of day in UTC
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)).toISOString();
  }
}

/**
 * Converts a UTC date string to local date object
 */
export function toLocal(dateStr: string | null, hasTime = false): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  if (!hasTime) {
    // If no time, ensure we're working with start of day in local timezone
    const localDate = new Date(dateStr);
    return new Date(localDate.getFullYear(), localDate.getMonth(), localDate.getDate(), 0, 0, 0, 0);
  }
  return date;
}

/**
 * Formats a date string according to the user's preferred format
 */
export function formatDateForDisplay(
  dateStr: string | null,
  format: DateFormat,
  locale = 'en'
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  return formatDate(date, format, locale);
}

/**
 * Formats a date for HTML date input (YYYY-MM-DD)
 */
export function formatDateForInput(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = toLocal(dateStr);
  if (!date) return '';

  return date.toISOString().split('T')[0];
}

/**
 * Get local timezone
 */
export function getLocalTimeZone(): string {
  // Simple implementation that works in browser environment
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Formats a date according to the specified format and locale
 */
export function formatDate(date: Date, format: DateFormat, locale = 'en'): string {
  // For 'd MMMM yyyy' format, use direct toLocaleDateString which handles it better
  if (format === 'd MMMM yyyy') {
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // For other formats, use more explicit formatting
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  // Format based on pattern
  switch (format) {
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'MM/dd/yyyy':
      return `${month}/${day}/${year}`;
    default:
      // Fallback to ISO format
      return `${year}-${month}-${day}`;
  }
}

/**
 * Converts an HTML date input value to UTC ISO string
 */
export function dateInputToUTC(inputValue: string): string | null {
  if (!inputValue) return null;

  // Create date object from input value (YYYY-MM-DD)
  const [year, month, day] = inputValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Checks if a date string is valid and can be parsed
 */
export function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Formats hours and minutes for an HTML time input (HH:MM)
 */
export function formatTimeForInput(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Date formats offered in Settings > Appearance, in the order of the list
 * (UPPERCASE convention used in AppSettings / IndexedDB). Grouped by what
 * comes first: day, year, month.
 *
 * The setting syncs as a free string inside the encrypted settings bundle, so
 * adding a format needs no schema change. A client that does not know a newer
 * format shows dates as ISO (`formatDateWithSetting` fallback) instead of
 * failing. `YYYY/MM/DD` and `YYYY.MM.DD` were added for Arabic users (#482).
 */
export const SETTINGS_DATE_FORMATS = [
  'DD/MM/YYYY',
  'DD.MM.YYYY',
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'YYYY.MM.DD',
  'MM/DD/YYYY'
] as const;

/**
 * Settings date format type (UPPERCASE convention used in AppSettings / IndexedDB).
 */
export type SettingsDateFormat = (typeof SETTINGS_DATE_FORMATS)[number];

/**
 * Formats a Date object according to the user's settings date format.
 * This is the shared helper used by both reborn-task and reborn-notes.
 * An unknown format (for example from a newer client) falls back to ISO.
 */
export function formatDateWithSetting(d: Date, fmt: SettingsDateFormat | string): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  switch (fmt) {
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'DD.MM.YYYY':
      return `${day}.${month}.${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'YYYY/MM/DD':
      return `${year}/${month}/${day}`;
    case 'YYYY.MM.DD':
      return `${year}.${month}.${day}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

/** The day every option label shows: the order of its parts is unambiguous. */
const DATE_FORMAT_SAMPLE_DAY = new Date(2024, 11, 31);

/**
 * Options for the date format picker in Settings > Appearance of both apps.
 * Each label is the sample day written in that format, e.g. "31/12/2024".
 */
export const SETTINGS_DATE_FORMAT_OPTIONS: ReadonlyArray<{
  value: SettingsDateFormat;
  label: string;
}> = SETTINGS_DATE_FORMATS.map((value) => ({
  value,
  label: formatDateWithSetting(DATE_FORMAT_SAMPLE_DAY, value)
}));

/**
 * Validates if a string is a valid DateFormat
 */
export function isValidDateFormat(format: string): format is DateFormat {
  return DATE_FORMATS.some((df) => df.key === format);
}
