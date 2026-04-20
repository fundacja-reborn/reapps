import { formatDateWithSetting } from '@reborn/utils';

export interface DueDateFormatResult {
	text: string;
	relativeText: string;
	status: 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'normal';
	isTimeOverdue: boolean;
}

// Map locale codes to browser-compatible ones
const localeMap: Record<string, string> = {
	en: 'en-US',
	pl: 'pl-PL'
};

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

export function getTimeString(date: Date, locale: string): string {
	const browserLocale = localeMap[locale || 'en'] || locale || 'en-US';
	return date.toLocaleTimeString(browserLocale, {
		hour: 'numeric',
		minute: '2-digit'
	});
}

/**
 * Formats a due date into a display-friendly result with status and relative text.
 *
 * @param dateString - ISO date string
 * @param hasTime - whether the task has a specific time set
 * @param locale - current locale code (e.g. 'en', 'pl')
 * @param t - translation function
 * @param dateFormat - user's preferred date format from settings (e.g. 'YYYY-MM-DD')
 */
export function formatDueDate(
	dateString: string | null | undefined,
	hasTime: boolean | undefined,
	locale: string,
	t: (key: string, options?: { values?: Record<string, unknown> }) => string,
	dateFormat: string = 'YYYY-MM-DD'
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
		if (hasTime) text = getTimeString(date, locale);
	} else if (isTomorrow(date)) {
		relativeText = t('tasks.date.tomorrow');
		if (hasTime) text = getTimeString(date, locale);
	} else if (isYesterday(date)) {
		relativeText = t('tasks.date.yesterday');
		if (hasTime) text = getTimeString(date, locale);
	} else if (daysFromToday > 0 && daysFromToday <= 3) {
		relativeText = t('tasks.date.in_n_days', { values: { count: daysFromToday } });
		if (hasTime) text = getTimeString(date, locale);
	} else {
		// For dates further away or in the past — use user's preferred format
		text = formatDateWithSetting(date, dateFormat);
		if (hasTime) text += ', ' + getTimeString(date, locale);
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
