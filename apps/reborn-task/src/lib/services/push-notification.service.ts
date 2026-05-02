/**
 * Push Notification Service
 *
 * Manages the full Web Push lifecycle:
 * - Permission request
 * - Subscription registration (saved to server)
 * - Local notification scheduling (via service worker messages)
 * - Sync with current task list
 */

import { browser } from '$app/environment';
import { PUBLIC_BASE_PATH } from '$env/static/public';
import { createLogger, parseUserAgent } from '@reborn/utils';
import { cryptoManager } from '@reborn/crypto';
import type { TaskListItem } from '$lib/services/task-title-index.svelte';

const logger = createLogger('PushNotificationService');

/** Default reminder lead time for tasks with `has_time === true` (minutes). */
export const DEFAULT_NOTIFICATION_LEAD_MINUTES = 60;
/** Default local clock time for date-only reminders (HH:MM). */
export const DEFAULT_NOTIFICATION_ALL_DAY_TIME = '09:00';

export interface ReminderTimingOptions {
	/** Minutes before `due_date` for tasks with `has_time === true`. */
	leadMinutes: number;
	/** Local 'HH:MM' string used as the fire time for date-only tasks. */
	allDayTime: string;
}

/** Pick of TaskListItem fields needed to compute reminder fire time. */
type ReminderTask = Pick<TaskListItem, 'due_date' | 'has_time'>;

/**
 * Compute the absolute timestamp at which a task's reminder should fire.
 *
 * - For tasks with `has_time === true`: fire `leadMinutes` before `due_date`.
 * - For date-only tasks (`has_time === false`): fire on the calendar day stored
 *   in `due_date` (UTC midnight) at the user's local `allDayTime`.
 *
 * Exported as a pure function for unit testing.
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

/**
 * Build the notification body text using translated strings.
 * - has_time: "scheduled for HH:MM" with the time formatted in user's locale.
 * - date-only with calendar day == today: "scheduled for today".
 * - date-only otherwise: "scheduled for {locale-formatted date}".
 */
type TranslateFn = (key: string, options?: { values?: Record<string, string | number> }) => string;

function formatReminderBody(task: ReminderTask, translate: TranslateFn, locale: string): string {
	if (!task.due_date) return translate('notifications.task_due.body_unknown');

	const due = new Date(task.due_date);
	if (Number.isNaN(due.getTime())) {
		return translate('notifications.task_due.body_unknown');
	}

	const localeTag = locale === 'pl' ? 'pl-PL' : locale;

	if (task.has_time) {
		const time = due.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' });
		return translate('notifications.task_due.body_time', { values: { time } });
	}

	// Date-only: compare UTC calendar day against today's local calendar day.
	const taskYear = due.getUTCFullYear();
	const taskMonth = due.getUTCMonth();
	const taskDay = due.getUTCDate();
	const today = new Date();
	if (
		taskYear === today.getFullYear() &&
		taskMonth === today.getMonth() &&
		taskDay === today.getDate()
	) {
		return translate('notifications.task_due.body_today');
	}

	const taskLocalDay = new Date(taskYear, taskMonth, taskDay);
	const date = taskLocalDay.toLocaleDateString(localeTag, {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	return translate('notifications.task_due.body_date', { values: { date } });
}

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

class PushNotificationService {
	/** True when browser supports Web Push */
	isSupported(): boolean {
		return (
			browser && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
		);
	}

	/** Current browser notification permission */
	getPermission(): PermissionState {
		if (!this.isSupported()) return 'unsupported';
		return Notification.permission as PermissionState;
	}

	/** Request browser notification permission.  Returns true if granted. */
	async requestPermission(): Promise<boolean> {
		if (!this.isSupported()) return false;
		if (Notification.permission === 'granted') return true;
		const result = await Notification.requestPermission();
		return result === 'granted';
	}

	/** Get VAPID public key from server */
	private async getVapidPublicKey(): Promise<string | null> {
		try {
			const res = await fetch(`${PUBLIC_BASE_PATH}/api/notifications/vapid-public-key`);
			if (!res.ok) return null;
			const data = (await res.json()) as { publicKey?: string };
			return data.publicKey ?? null;
		} catch {
			return null;
		}
	}

	/** Register a push subscription and save it to the server. */
	async subscribe(): Promise<PushSubscription | null> {
		if (!this.isSupported() || Notification.permission !== 'granted') return null;

		try {
			const registration = await navigator.serviceWorker.ready;
			const vapidKey = await this.getVapidPublicKey();
			if (!vapidKey) {
				logger.error('Could not fetch VAPID public key');
				return null;
			}

			// Check if already subscribed
			let subscription = await registration.pushManager.getSubscription();

			if (!subscription) {
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(vapidKey)
				});
			}

			// Save to server
			await this.saveSubscriptionToServer(subscription);
			logger.info('Push subscription registered');
			return subscription;
		} catch (error: unknown) {
			logger.error('Failed to register push subscription', error);
			return null;
		}
	}

	/** Unsubscribe from push and remove from server. */
	async unsubscribe(): Promise<boolean> {
		if (!this.isSupported()) return false;

		try {
			const registration = await navigator.serviceWorker.ready;
			const subscription = await registration.pushManager.getSubscription();
			if (!subscription) return true;

			await this.removeSubscriptionFromServer(subscription.endpoint);
			const result = await subscription.unsubscribe();
			logger.info('Push subscription removed');
			return result;
		} catch (error: unknown) {
			logger.error('Failed to unsubscribe from push', error);
			return false;
		}
	}

	/** Get current push subscription (null if not subscribed). */
	async getSubscription(): Promise<PushSubscription | null> {
		if (!this.isSupported()) return null;
		try {
			const registration = await navigator.serviceWorker.ready;
			return registration.pushManager.getSubscription();
		} catch {
			return null;
		}
	}

	/**
	 * Sync scheduled local notifications with current task list.
	 * Cancels obsolete reminders and schedules upcoming ones.
	 *
	 * Timing options come from `AppSettings`:
	 * - tasks with `has_time === true`: fire `leadMinutes` before `due_date`.
	 * - date-only tasks: fire on the calendar day at the local `allDayTime`.
	 */
	async syncScheduledNotifications(
		tasks: TaskListItem[],
		options: ReminderTimingOptions = {
			leadMinutes: DEFAULT_NOTIFICATION_LEAD_MINUTES,
			allDayTime: DEFAULT_NOTIFICATION_ALL_DAY_TIME
		}
	): Promise<void> {
		if (!this.isSupported() || Notification.permission !== 'granted') return;

		const sw = await navigator.serviceWorker.ready;
		const now = Date.now();
		const window24h = 24 * 60 * 60 * 1000;

		// Lazy import to avoid pulling i18n into worker contexts.
		const [{ get }, { t }, { currentLanguage }] = await Promise.all([
			import('svelte/store'),
			import('$lib/stores/i18n.store'),
			import('$lib/stores/app-settings.store')
		]);
		const translate = get(t) as TranslateFn;
		const locale = get(currentLanguage);

		// Cancel all existing scheduled reminders first
		sw.active?.postMessage({ type: 'CANCEL_ALL_NOTIFICATIONS' });

		for (const task of tasks) {
			if (task.is_completed || task.deleted_at || !task.due_date) continue;

			const fireAt = computeReminderFireAt(task, options);
			if (fireAt === null) continue;

			// Only schedule if in the future and within 24 hours (SW lifecycle limit)
			if (fireAt <= now || fireAt > now + window24h) continue;

			const body = formatReminderBody(task, translate, locale);

			sw.active?.postMessage({
				type: 'SCHEDULE_NOTIFICATION',
				notification: {
					taskId: task.id,
					title: task.title,
					body,
					fireAt,
					url: `/tasks/${task.id}`
				}
			});
		}
	}

	/** Cancel a single scheduled notification. */
	async cancelNotification(taskId: string): Promise<void> {
		if (!this.isSupported()) return;
		const sw = await navigator.serviceWorker.ready;
		sw.active?.postMessage({ type: 'CANCEL_NOTIFICATION', taskId });
	}

	/**
	 * Trigger a test notification immediately to verify the end-to-end pipeline
	 * (permission → service worker → system notification center).
	 *
	 * Uses registration.showNotification() from the main thread instead of
	 * postMessage to the SW — this way the call is awaitable and doesn't
	 * depend on the SW staying alive long enough to handle the message.
	 */
	async sendTestNotification(): Promise<boolean> {
		if (!this.isSupported() || Notification.permission !== 'granted') return false;
		try {
			const registration = await navigator.serviceWorker.ready;
			await registration.showNotification('re/task', {
				body: 'Testowe powiadomienie — pipeline działa poprawnie.',
				icon: `${PUBLIC_BASE_PATH}/icons/icon-192.png`,
				badge: `${PUBLIC_BASE_PATH}/icons/icon-192.png`,
				data: { url: '/' },
				tag: `reborn-task-test-${Date.now()}`
			});
			return true;
		} catch (error: unknown) {
			logger.error('Failed to send test notification', error);
			return false;
		}
	}

	// ---- Private helpers ----

	private async saveSubscriptionToServer(subscription: PushSubscription): Promise<void> {
		const accessToken = localStorage.getItem('access_token');
		if (!accessToken) {
			logger.warn('No access token — cannot save push subscription to server');
			return;
		}

		const json = subscription.toJSON();

		// Encrypt parsed UA label instead of sending raw navigator.userAgent
		let deviceInfoEncrypted: string | null = null;
		if (cryptoManager.isInitialized()) {
			try {
				deviceInfoEncrypted = await cryptoManager.encryptText(parseUserAgent(navigator.userAgent));
			} catch {
				// Non-critical — send null
			}
		}

		const res = await fetch(`${PUBLIC_BASE_PATH}/api/notifications/subscribe`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({
				endpoint: subscription.endpoint,
				keys: json.keys,
				device_info_encrypted: deviceInfoEncrypted
			})
		});

		if (!res.ok) {
			logger.error('Failed to save push subscription to server', { status: res.status });
			throw new Error(`Subscribe request failed: ${res.status}`);
		}
	}

	private async removeSubscriptionFromServer(endpoint: string): Promise<void> {
		const accessToken = localStorage.getItem('access_token');
		if (!accessToken) {
			logger.warn('No access token — cannot remove push subscription from server');
			return;
		}

		const res = await fetch(`${PUBLIC_BASE_PATH}/api/notifications/subscribe`, {
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({ endpoint })
		});

		if (!res.ok) {
			logger.error('Failed to remove push subscription from server', { status: res.status });
		}
	}
}

/** Convert base64url VAPID public key to Uint8Array backed by an ArrayBuffer */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const buffer = new ArrayBuffer(rawData.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < rawData.length; i++) {
		bytes[i] = rawData.charCodeAt(i);
	}
	return bytes;
}

export const pushNotificationService = new PushNotificationService();
