/**
 * Task reminders in the native shells (Android / iOS): device-local
 * notifications planned by the phone itself from the decrypted tasks, through
 * `@capacitor/local-notifications`. The system delivers them while the app is
 * closed, after a reboot too (the plugin restores its alarms on Android, iOS
 * keeps the requests).
 *
 * Zero-Knowledge: the server learns nothing - no `fire_at`, no subscription,
 * no request at all (less than Web Push on the web, where the server-assisted
 * path sees 5-minute buckets). Title and body are built here, after
 * decryption, and handed to the system notification center, as the service
 * worker does on the web. The plan sits in the plugin's storage on the device
 * (Android: app-private, outside OS backups - `allowBackup="false"`; iOS: the
 * system's pending-request store) until it fires or is cancelled; every logout
 * and data wipe cancels it.
 *
 * Same timing and text as the web (`reminder-schedule.ts`): `leadMinutes`
 * before a task with a time, `allDayTime` on the day of a date-only task.
 *
 * Limits:
 * - A reminder added on another device is planned once the app opens here and
 *   syncs (there is no server push to wake it).
 * - iOS keeps at most 64 pending local notifications per app, so the nearest
 *   {@link MAX_PLANNED_REMINDERS} are planned (the same cap on Android, for one
 *   behaviour); every open, resume and change re-plans the window.
 * - Android 12+ may deliver up to an hour late unless the user allows exact
 *   alarms (`SCHEDULE_EXACT_ALARM`, off by default from Android 14); the
 *   plugin uses an exact alarm when allowed and falls back to an inexact one.
 *   Settings > Notifications offers the switch (decision 2026-11-28).
 */

import { createLogger } from '@reborn/utils';
import {
	computeReminderFireAt,
	formatReminderBody,
	type ReminderTimingOptions,
	type TranslateFn
} from '$lib/services/reminder-schedule';
import type { TaskListItem } from '$lib/services/task-title-index.svelte';

const logger = createLogger('NativeReminders');

/** iOS allows 64 pending local notifications per app; keep a margin. */
export const MAX_PLANNED_REMINDERS = 60;

/** Android channel of task reminders (name localized at plan time). */
export const REMINDER_CHANNEL_ID = 'task-reminders';

/** Id of the one-off test notification from Settings, outside the reminder range. */
const TEST_NOTIFICATION_ID = 1;

/** Fields of a task the planner reads. */
export type PlannableTask = Pick<
	TaskListItem,
	'id' | 'title' | 'due_date' | 'has_time' | 'is_completed' | 'is_template' | 'deleted_at'
>;

export interface PlannedReminder {
	/** Notification id (stable per task, see {@link reminderIdForTask}). */
	id: number;
	taskId: string;
	/** Epoch ms to fire at. */
	at: number;
	title: string;
	body: string;
}

/**
 * Stable 31-bit notification id for a task (FNV-1a of the UUID). The plugin
 * needs an int (a Java `int` on Android); a stable one means a re-plan
 * replaces the task's own notification instead of stacking a second one.
 * Never 0 or {@link TEST_NOTIFICATION_ID}.
 */
export function reminderIdForTask(taskId: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < taskId.length; i++) {
		hash ^= taskId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	const id = hash & 0x7fffffff;
	return id <= TEST_NOTIFICATION_ID ? id + 2 : id;
}

/**
 * Pure planning decision (unit-tested; the plugin calls below are dead code
 * under vitest): the nearest `limit` future reminders of open, dated tasks,
 * soonest first. `describe` builds the body for a task at its fire time.
 */
export function planTaskReminders(
	tasks: readonly PlannableTask[],
	options: ReminderTimingOptions,
	now: number,
	describe: (task: PlannableTask, fireAt: number) => string,
	limit: number = MAX_PLANNED_REMINDERS
): PlannedReminder[] {
	const upcoming: { task: PlannableTask; at: number }[] = [];
	for (const task of tasks) {
		if (task.is_completed || task.is_template || task.deleted_at || !task.due_date) continue;
		const at = computeReminderFireAt(task, options);
		if (at === null || at <= now) continue;
		upcoming.push({ task, at });
	}
	upcoming.sort((a, b) => a.at - b.at || (a.task.id < b.task.id ? -1 : 1));

	const used = new Set<number>();
	return upcoming.slice(0, limit).map(({ task, at }) => {
		// Hash collisions are rare at this size; probe to the next free id.
		let id = reminderIdForTask(task.id);
		while (used.has(id)) id = id >= 0x7fffffff ? 2 : id + 1;
		used.add(id);
		return { id, taskId: task.id, at, title: task.title, body: describe(task, at) };
	});
}

export interface NativeReminderInput {
	/** The user's `notifications_enabled` setting (synced across devices). */
	enabled: boolean;
	tasks: readonly PlannableTask[];
	options: ReminderTimingOptions;
}

/** OS notification permission, as Settings describe it. */
export type NativeNotificationPermission = 'granted' | 'denied' | 'prompt';

/** Android exact-alarm state; `unsupported` = iOS (always on time there). */
export type ExactAlarmState = 'granted' | 'denied' | 'unsupported';

// What the plugin holds now, so an unchanged plan (the 15-minute tick, a
// resume without changes) costs nothing. In memory only: a restart re-plans
// once. 'off' = everything cancelled because reminders are turned off.
let appliedSignature: string | null = null;
// Runs one at a time: a cancel-all from one run must not land between the
// cancel and the schedule of another.
let queue: Promise<void> = Promise.resolve();

function serialize(run: () => Promise<void>): Promise<void> {
	queue = queue.then(run).catch((err: unknown) => {
		appliedSignature = null;
		logger.warn('Native reminder planning failed:', err);
	});
	return queue;
}

async function loadPlugin() {
	const { LocalNotifications } = await import('@capacitor/local-notifications');
	return LocalNotifications;
}

async function isAndroid(): Promise<boolean> {
	const { Capacitor } = await import('@capacitor/core');
	return Capacitor.getPlatform() === 'android';
}

/**
 * The Android channel of reminders, high importance (sound + heads-up, the
 * user can lower it in the system settings). Creating an existing channel only
 * updates its name - the user's own choices stay - so this also follows the
 * app language.
 */
async function ensureReminderChannel(name: string): Promise<void> {
	await (await loadPlugin()).createChannel({ id: REMINDER_CHANNEL_ID, name, importance: 4 });
}

async function cancelAllPending(): Promise<void> {
	const LocalNotifications = await loadPlugin();
	const { notifications } = await LocalNotifications.getPending();
	if (notifications.length === 0) return;
	await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
}

/**
 * Bring the device's planned reminders in line with the tasks and settings.
 * Idempotent; never throws. Callers must pass the decrypted tasks of an
 * unlocked app - while the master key is missing the store is empty, and
 * planning from it would cancel every reminder (the caller skips then).
 */
export function syncNativeReminders(input: NativeReminderInput): Promise<void> {
	if (!__REBORN_NATIVE__) return Promise.resolve();
	return serialize(async () => {
		if (!input.enabled) {
			if (appliedSignature === 'off') return;
			await cancelAllPending();
			appliedSignature = 'off';
			return;
		}

		const LocalNotifications = await loadPlugin();
		if ((await LocalNotifications.checkPermissions()).display !== 'granted') {
			// Nothing would show. Leave what is there (granting the permission
			// later re-plans through the resume / settings triggers).
			appliedSignature = null;
			return;
		}
		const android = await isAndroid();
		const exact = android ? await readExactAlarmState() : 'unsupported';

		const [{ get }, { t }, { currentLanguage, timeFormat }] = await Promise.all([
			import('svelte/store'),
			import('$lib/stores/i18n.store'),
			import('$lib/stores/app-settings.store')
		]);
		const translate = get(t) as TranslateFn;
		const locale = get(currentLanguage);
		const clock = get(timeFormat);

		const plan = planTaskReminders(input.tasks, input.options, Date.now(), (task, fireAt) =>
			formatReminderBody(task, translate, locale, clock, new Date(fireAt))
		);
		const channelName = translate('notifications.channel_reminders');
		// The exact-alarm state is part of it: an alarm keeps the mode it was set
		// with, so allowing exact alarms must re-plan the same reminders.
		const signature = JSON.stringify([exact, channelName, plan]);
		if (signature === appliedSignature) return;

		if (android) await ensureReminderChannel(channelName);
		await cancelAllPending();
		if (plan.length > 0) {
			await LocalNotifications.schedule({
				notifications: plan.map((r) => ({
					id: r.id,
					title: r.title,
					body: r.body,
					channelId: REMINDER_CHANNEL_ID,
					extra: { taskId: r.taskId },
					schedule: { at: new Date(r.at), allowWhileIdle: true }
				}))
			});
		}
		appliedSignature = signature;
	});
}

/**
 * Cancel every planned reminder: logout, account deletion, data wipe. Runs
 * before the hard redirect, so the next account never inherits the previous
 * one's reminders (their titles are in the plan). Never throws.
 */
export function cancelNativeReminders(): Promise<void> {
	if (!__REBORN_NATIVE__) return Promise.resolve();
	return serialize(async () => {
		await cancelAllPending();
		appliedSignature = 'off';
	});
}

/** The OS notification permission. Never throws. */
export async function getNativeNotificationPermission(): Promise<NativeNotificationPermission> {
	if (!__REBORN_NATIVE__) return 'denied';
	try {
		return toPermission((await (await loadPlugin()).checkPermissions()).display);
	} catch {
		return 'denied';
	}
}

/** Ask for the notification permission (Android 13+, iOS). Never throws. */
export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
	if (!__REBORN_NATIVE__) return 'denied';
	try {
		const LocalNotifications = await loadPlugin();
		const current = toPermission((await LocalNotifications.checkPermissions()).display);
		if (current !== 'prompt') return current;
		return toPermission((await LocalNotifications.requestPermissions()).display);
	} catch (err) {
		logger.warn('Notification permission request failed:', err);
		return 'denied';
	}
}

// `prompt-with-rationale` (Android) is still "not decided yet".
function toPermission(display: string): NativeNotificationPermission {
	return display === 'granted' || display === 'denied' ? display : 'prompt';
}

async function readExactAlarmState(): Promise<ExactAlarmState> {
	const { exact_alarm } = await (await loadPlugin()).checkExactNotificationSetting();
	return exact_alarm === 'granted' ? 'granted' : 'denied';
}

/** Whether Android lets the app set exact alarms. Never throws. */
export async function getExactAlarmState(): Promise<ExactAlarmState> {
	if (!__REBORN_NATIVE__) return 'unsupported';
	try {
		if (!(await isAndroid())) return 'unsupported';
		return await readExactAlarmState();
	} catch {
		return 'unsupported';
	}
}

/**
 * Open the system page where the user allows exact alarms for re/task
 * ("Alarms & reminders"); resolves with the state after they come back.
 * Android 11 and older have no such page and report `granted`.
 */
export async function openExactAlarmSettings(): Promise<ExactAlarmState> {
	if (!__REBORN_NATIVE__) return 'unsupported';
	try {
		if (!(await isAndroid())) return 'unsupported';
		const { exact_alarm } = await (await loadPlugin()).changeExactNotificationSetting();
		return exact_alarm === 'granted' ? 'granted' : 'denied';
	} catch (err) {
		logger.warn('Opening the exact alarm settings failed:', err);
		return 'denied';
	}
}

/**
 * Whether this build can open the app's page in the system Settings, where
 * notifications are turned back on: iOS (`app-settings:`). Android has no
 * such link without another plugin, so Settings say where to look instead.
 */
export async function canOpenNotificationSettings(): Promise<boolean> {
	if (!__REBORN_NATIVE__) return false;
	try {
		const { Capacitor } = await import('@capacitor/core');
		return Capacitor.getPlatform() === 'ios';
	} catch {
		return false;
	}
}

/** Open the app's page in iOS Settings (see {@link canOpenNotificationSettings}). */
export async function openNotificationSettings(): Promise<boolean> {
	if (!(await canOpenNotificationSettings())) return false;
	// Capacitor hands a new-window URL to UIApplication.open; `app-settings:`
	// (UIApplication.openSettingsURLString) opens the app's page in Settings.
	window.open('app-settings:', '_blank');
	return true;
}

/** Show a notification right away (Settings > Send test notification). */
export async function sendNativeTestNotification(title: string, body: string): Promise<boolean> {
	if (!__REBORN_NATIVE__) return false;
	try {
		const LocalNotifications = await loadPlugin();
		if ((await LocalNotifications.checkPermissions()).display !== 'granted') return false;
		const channelId = (await isAndroid()) ? REMINDER_CHANNEL_ID : undefined;
		if (channelId) {
			const [{ get }, { t }] = await Promise.all([
				import('svelte/store'),
				import('$lib/stores/i18n.store')
			]);
			await ensureReminderChannel((get(t) as TranslateFn)('notifications.channel_reminders'));
		}
		await LocalNotifications.schedule({
			notifications: [{ id: TEST_NOTIFICATION_ID, title, body, channelId }]
		});
		return true;
	} catch (err) {
		logger.warn('Test notification failed:', err);
		return false;
	}
}

/**
 * Call `open(taskId)` when the user taps a reminder. The plugin keeps a tap
 * that started the app until a listener is attached, so registering at boot
 * also catches the cold start. Returns the unsubscribe function.
 */
export function onReminderTap(open: (taskId: string) => void): () => void {
	if (!__REBORN_NATIVE__) return () => {};
	let removed = false;
	let handle: { remove: () => Promise<void> } | null = null;
	void loadPlugin()
		.then((LocalNotifications) =>
			LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
				const taskId = (action.notification.extra as { taskId?: unknown } | undefined)?.taskId;
				if (typeof taskId === 'string' && taskId) open(taskId);
			})
		)
		.then((h) => {
			handle = h;
			if (removed) void h.remove();
		})
		.catch((err: unknown) => logger.warn('Reminder tap listener failed:', err));
	return () => {
		removed = true;
		void handle?.remove();
	};
}
