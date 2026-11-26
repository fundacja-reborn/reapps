import { formatDateTime, formatTimeOfDay, intlLocale } from '@reborn/i18n/config';
import { formatDateWithSetting } from '@reborn/utils';

export interface DueDateFormatResult {
	text: string;
	relativeText: string;
	status: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'normal';
	isTimeOverdue: boolean;
}

// --- Date helpers (pure functions) ---

export function isSameDay(date1: Date, date2: Date): boolean {
	return (
		date1.getFullYear() === date2.getFullYear() &&
		date1.getMonth() === date2.getMonth() &&
		date1.getDate() === date2.getDate()
	);
}

export function isToday(date: Date): boolean {
	return isSameDay(date, new Date());
}

export function isTomorrow(date: Date): boolean {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	return isSameDay(date, tomorrow);
}

export function isYesterday(date: Date): boolean {
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	return isSameDay(date, yesterday);
}

export function getDaysFromToday(date: Date): number {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const targetDate = new Date(date);
	targetDate.setHours(0, 0, 0, 0);

	const diffTime = targetDate.getTime() - today.getTime();
	return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Date and time of a moment, as the apps show it to the signed-in user: the
 * date in the format from Settings > Appearance, the time of day on the 12h /
 * 24h clock from the same card ("2026-04-05, 14:32"; on the 12h clock the
 * language words the AM/PM marker). The same formatter as in re/notes
 * (`formatSettingsDateTime` there), for shares, sessions and the trash.
 *
 * The result is digits and punctuation, at most with a marker at the end.
 * After a label render it in `<bdi dir={$textDirection}>`; inside a sentence
 * built in code pass it through `isolateInDirection` (guideline 74).
 */
export function formatSettingsDateTime(
	date: Date | string | number,
	dateFormat: string,
	timeFormat: string,
	locale: string | null | undefined
): string {
	const d = new Date(date);
	return `${formatDateWithSetting(d, dateFormat)}, ${formatTimeOfDay(d, locale, timeFormat)}`;
}

/** Time of day in the app language, on the user's 12h/24h clock (`timeFormat` setting). */
export function getTimeString(date: Date, locale: string, timeFormat: string = '24h'): string {
	return formatTimeOfDay(date, locale, timeFormat);
}

/**
 * Due date of a shared task snapshot. `timeFormat` null = the public share
 * page: the visitor has no account settings, so the language shapes the date
 * and picks the clock. A string = the owner's preview of their share, on
 * their 12h/24h clock.
 *
 * A date-only task keeps its calendar day as UTC midnight (see
 * `computeReminderFireAt`), so it formats in UTC and without a time of day.
 * Read in the viewer's zone it showed "1:00:00 AM" in Poland, and west of UTC
 * it would land on the previous day. A task with a time formats in the
 * viewer's zone, like everywhere else in the app.
 */
export function formatSnapshotDueDate(
	iso: string | null | undefined,
	hasTime: boolean | undefined,
	locale: string | null | undefined,
	timeFormat: string | null
): string {
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	if (timeFormat === null) {
		const tag = intlLocale(locale);
		// date-format-ignore: public share page - the visitor has no account settings
		if (!hasTime) return date.toLocaleDateString(tag, { timeZone: 'UTC' });
		// time-format-ignore: public share page - the visitor has no account settings, so the clock follows the language
		return date.toLocaleString(tag);
	}
	// date-format-ignore: owner preview of a share, in the style of its "Shared" line
	return hasTime
		? formatDateTime(date, locale, timeFormat)
		: formatDateTime(date, locale, timeFormat, { dateStyle: 'medium', timeZone: 'UTC' });
}

/**
 * Formats a due date into a display-friendly result with status and relative text.
 *
 * @param dateString - ISO date string
 * @param hasTime - whether the task has a specific time set
 * @param locale - current locale code (e.g. 'en', 'pl')
 * @param t - translation function
 * @param dateFormat - user's preferred date format from settings (e.g. 'YYYY-MM-DD')
 * @param timeFormat - user's 12h/24h setting; decides the clock of the time part
 */
export function formatDueDate(
	dateString: string | null | undefined,
	hasTime: boolean | undefined,
	locale: string,
	t: (key: string, options?: { values?: Record<string, unknown> }) => string,
	dateFormat: string = 'YYYY-MM-DD',
	timeFormat: string = '24h'
): DueDateFormatResult | null {
	if (!dateString) return null;

	const date = new Date(dateString);
	const now = new Date();
	const daysFromToday = getDaysFromToday(date);

	// Check if overdue (for time)
	const isTimeOverdue = !!hasTime && isToday(date) && date < now;

	// Determine status
	let status: DueDateFormatResult['status'] = 'normal';
	if (daysFromToday < 0) {
		status = 'overdue';
	} else if (isToday(date)) {
		status = 'today';
	} else if (isTomorrow(date)) {
		status = 'tomorrow';
	} else if (daysFromToday > 0 && daysFromToday <= 3) {
		status = 'upcoming';
	}

	// Format date text
	let text = '';
	let relativeText = '';

	if (isToday(date)) {
		relativeText = t('tasks.date.today');
		if (hasTime) text = getTimeString(date, locale, timeFormat);
	} else if (isTomorrow(date)) {
		relativeText = t('tasks.date.tomorrow');
		if (hasTime) text = getTimeString(date, locale, timeFormat);
	} else if (isYesterday(date)) {
		relativeText = t('tasks.date.yesterday');
		if (hasTime) text = getTimeString(date, locale, timeFormat);
	} else if (daysFromToday > 0 && daysFromToday <= 3) {
		relativeText = t('tasks.date.in_n_days', { values: { count: daysFromToday } });
		if (hasTime) text = getTimeString(date, locale, timeFormat);
	} else {
		// For dates further away or in the past - use user's preferred format
		text = formatDateWithSetting(date, dateFormat);
		if (hasTime) text += ', ' + getTimeString(date, locale, timeFormat);
	}

	return { text, relativeText, status, isTimeOverdue };
}

// --- Text truncation helpers ---

export function truncateDescription(text: string | null, maxLength = 100): string {
	if (!text) return '';

	const cleanText = text
		.replace(/[\r\n\t\f\v]+/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();

	if (cleanText.length <= maxLength) return cleanText;
	return cleanText.substring(0, maxLength).trim() + '...';
}

export function truncateListName(name: string | null, maxLength = 30): string {
	if (!name) return '';
	if (name.length <= maxLength) return name;
	return name.substring(0, maxLength) + '...';
}
