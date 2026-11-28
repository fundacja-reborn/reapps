/**
 * When a task reminder fires and what it says - shared by both delivery paths:
 * Web Push with the service worker on the web (`push-notification.service.ts`)
 * and device-local notifications in the native shells
 * (`native-reminders.ts`). Pure: no browser APIs, no stores.
 */

import { formatTimeOfDay, intlLocale } from '@reborn/i18n/config';
import type { TaskListItem } from '$lib/services/task-title-index.svelte';

/** Default reminder lead time for tasks with `has_time === true` (minutes). */
export const DEFAULT_NOTIFICATION_LEAD_MINUTES = 60;
/** Default local clock time for date-only reminders (HH:MM). */
export const DEFAULT_NOTIFICATION_ALL_DAY_TIME = '09:00';

export interface ReminderTimingOptions {
	/** Minutes before `due_date` for tasks with `has_time === true`. */
	leadMinutes: number;
	/** Local 'HH:MM' string used as the fire time for date-only tasks. */
	allDayTime: string;
	/**
	 * Web only. When true, the client posts schedules to
	 * /api/notifications/schedule so the server cron can wake the SW even with
	 * the app closed. When false, notifications only fire while a tab is open
	 * (legacy SW-poll path). Server never receives `fire_at` in the OFF state.
	 * The native shells plan on the device and ignore it.
	 */
	backgroundDelivery?: boolean;
}

/** Pick of TaskListItem fields needed to compute reminder fire time. */
export type ReminderTask = Pick<TaskListItem, 'due_date' | 'has_time'>;

/**
 * Compute the absolute timestamp at which a task's reminder should fire.
 *
 * - For tasks with `has_time === true`: fire `leadMinutes` before `due_date`.
 * - For date-only tasks (`has_time === false`): fire on the calendar day stored
 *   in `due_date` (UTC midnight) at the user's local `allDayTime`.
 */
export function computeReminderFireAt(
	task: ReminderTask,
	options: ReminderTimingOptions
): number | null {
	if (!task.due_date) return null;

	const due = new Date(task.due_date);
	if (Number.isNaN(due.getTime())) return null;

	if (task.has_time) {
		return due.getTime() - options.leadMinutes * 60_000;
	}

	// Date-only: due_date is UTC midnight; treat its UTC date components as the
	// user's local calendar day, then assemble a local Date at allDayTime.
	const [hh, mm] = parseAllDayTime(options.allDayTime);
	return new Date(
		due.getUTCFullYear(),
		due.getUTCMonth(),
		due.getUTCDate(),
		hh,
		mm,
		0,
		0
	).getTime();
}

/** Parse 'HH:MM' into [hour, minute]. Falls back to default on invalid input. */
function parseAllDayTime(value: string): [number, number] {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return parseAllDayTime(DEFAULT_NOTIFICATION_ALL_DAY_TIME);
	const h = Number(match[1]);
	const m = Number(match[2]);
	if (h < 0 || h > 23 || m < 0 || m > 59) {
		return parseAllDayTime(DEFAULT_NOTIFICATION_ALL_DAY_TIME);
	}
	return [h, m];
}

export type TranslateFn = (
	key: string,
	options?: { values?: Record<string, string | number> }
) => string;

/**
 * Build the notification body text using translated strings.
 * - has_time: "scheduled for HH:MM" in the user's language, on their 12h/24h clock.
 * - date-only with calendar day == `today`: "scheduled for today".
 * - date-only otherwise: "scheduled for {locale-formatted date}".
 *
 * `today` is the moment the text is read against: the web builds it for the
 * next 24 h, so "now" is close enough; the native shells plan days ahead and
 * pass the fire time, so a date-only reminder on its due day says "today".
 */
export function formatReminderBody(
	task: ReminderTask,
	translate: TranslateFn,
	locale: string,
	timeFormat: string,
	today: Date = new Date()
): string {
	if (!task.due_date) return translate('notifications.task_due.body_unknown');

	const due = new Date(task.due_date);
	if (Number.isNaN(due.getTime())) {
		return translate('notifications.task_due.body_unknown');
	}

	const localeTag = intlLocale(locale);

	if (task.has_time) {
		const time = formatTimeOfDay(due, locale, timeFormat);
		return translate('notifications.task_due.body_time', { values: { time } });
	}

	// Date-only: compare UTC calendar day against today's local calendar day.
	const taskYear = due.getUTCFullYear();
	const taskMonth = due.getUTCMonth();
	const taskDay = due.getUTCDate();
	if (
		taskYear === today.getFullYear() &&
		taskMonth === today.getMonth() &&
		taskDay === today.getDate()
	) {
		return translate('notifications.task_due.body_today');
	}

	const taskLocalDay = new Date(taskYear, taskMonth, taskDay);
	// date-format-ignore: a sentence in a system notification ("... scheduled for November 17, 2026"), outside the app's layout
	const date = taskLocalDay.toLocaleDateString(localeTag, {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	return translate('notifications.task_due.body_date', { values: { date } });
}
