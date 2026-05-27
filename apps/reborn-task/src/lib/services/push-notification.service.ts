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
import { pushSyncError } from '$lib/stores/push-sync-error.store';
import type { TaskListItem } from '$lib/services/task-title-index.svelte';

const logger = createLogger('PushNotificationService');

/** Default reminder lead time for tasks with `has_time === true` (minutes). */
export const DEFAULT_NOTIFICATION_LEAD_MINUTES = 60;
/** Default local clock time for date-only reminders (HH:MM). */
export const DEFAULT_NOTIFICATION_ALL_DAY_TIME = '09:00';

/**
 * Server-side schedule bucketing - rounds `fire_at` DOWN to the nearest
 * 5-minute mark (matches cron tick cadence). Floor (not round) guarantees the
 * notification never arrives LATER than promised, only up to 5 min earlier
 * (better UX trade-off than slipping past the deadline). This bucketing is the
 * sole ZK leakage tunable: 5-min precision is documented in
 * docs/security/security-overview.md §7.
 */
export const SERVER_SCHEDULE_BUCKET_MS = 5 * 60 * 1000;

export interface ReminderTimingOptions {
	/** Minutes before `due_date` for tasks with `has_time === true`. */
	leadMinutes: number;
	/** Local 'HH:MM' string used as the fire time for date-only tasks. */
	allDayTime: string;
	/**
	 * When true, the client posts schedules to /api/notifications/schedule so
	 * the server cron can wake the SW even with the app closed. When false,
	 * notifications only fire while a tab is open (legacy SW-poll path).
	 * Server never receives `fire_at` in the OFF state.
	 */
	backgroundDelivery?: boolean;
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

	/**
	 * Register a push subscription and save it to the server.
	 *
	 * Idempotent - calling this with an already-valid subscription is a no-op
	 * apart from re-saving the subscription to the server (also idempotent via
	 * `upsert` keyed on endpoint). Designed to be called on every app start so
	 * we self-heal after edge cases:
	 *
	 * - VAPID key rotation server-side: the push service ties a subscription
	 *   to the public key it was created with. If `VAPID_PRIVATE_KEY` rotates
	 *   on the server, FCM/Mozilla reject every message with 403
	 *   ("the VAPID credentials in the authorization header do not correspond
	 *   to the credentials used to create the subscriptions"). Without
	 *   recovery, the only escape is for the user to manually toggle off→on
	 *   in /settings/notifications. We compare the existing subscription's
	 *   `applicationServerKey` to the current server VAPID key and re-subscribe
	 *   transparently on mismatch.
	 *
	 * - Server-side subscription row marked inactive after a 410/Gone from the
	 *   push service: re-saving via this code path re-activates it.
	 */
	async subscribe(): Promise<PushSubscription | null> {
		if (!this.isSupported() || Notification.permission !== 'granted') return null;

		try {
			const registration = await navigator.serviceWorker.ready;
			const vapidKey = await this.getVapidPublicKey();
			if (!vapidKey) {
				logger.error('Could not fetch VAPID public key');
				return null;
			}

			let subscription = await registration.pushManager.getSubscription();

			// VAPID rotation guard: if the existing subscription was created under
			// a different server public key than the one currently served, every
			// push will be rejected by the push service. Detect mismatch and
			// transparently re-subscribe so an admin rotation doesn't silently
			// break delivery until each user manually re-toggles notifications.
			if (subscription && !subscriptionMatchesVapidKey(subscription, vapidKey)) {
				logger.info('VAPID key mismatch detected - resubscribing');
				try {
					await this.removeSubscriptionFromServer(subscription.endpoint);
				} catch {
					/* best-effort cleanup of the now-stale server-side row */
				}
				await subscription.unsubscribe();
				subscription = null;
			}

			if (!subscription) {
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(vapidKey)
				});
			}

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
	 * Two delivery paths run in parallel; both reuse the same `task-<id>` SW
	 * notification tag so a duplicate fire from both paths replaces, never
	 * stacks (same tag = one visible notification):
	 *
	 * 1. **Local SW poll** (always on, 24h window). The SW's in-memory map
	 *    survives until the browser idle-kills the worker. Reliable while the
	 *    app is in the foreground.
	 *
	 * 2. **Server-assisted push** (gated by `backgroundDelivery`, 7d window,
	 *    5-min bucketing). Posts `(task_id, fire_at)` to
	 *    /api/notifications/schedule so the server cron can wake the SW with
	 *    a generic push - the SW then decrypts the task locally and shows
	 *    the real title/body. Required for notifications when the app is
	 *    closed (most realistic mobile scenario).
	 *
	 * Timing options come from `AppSettings`:
	 * - tasks with `has_time === true`: fire `leadMinutes` before `due_date`.
	 * - date-only tasks: fire on the calendar day at the local `allDayTime`.
	 */
	async syncScheduledNotifications(
		tasks: TaskListItem[],
		options: ReminderTimingOptions = {
			leadMinutes: DEFAULT_NOTIFICATION_LEAD_MINUTES,
			allDayTime: DEFAULT_NOTIFICATION_ALL_DAY_TIME,
			backgroundDelivery: true
		}
	): Promise<void> {
		if (!this.isSupported() || Notification.permission !== 'granted') return;

		const sw = await navigator.serviceWorker.ready;
		const now = Date.now();
		const window24h = 24 * 60 * 60 * 1000;
		const window7d = 7 * 24 * 60 * 60 * 1000;

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

		// Server-side schedule items, bucketed to 5 min. Built in the same loop
		// so the local SW path and the server path see exactly the same set of
		// (task, fireAt) pairs (modulo bucketing).
		const serverItems: { task_id: string; fire_at: string }[] = [];

		for (const task of tasks) {
			if (task.is_completed || task.deleted_at || !task.due_date) continue;

			const fireAt = computeReminderFireAt(task, options);
			if (fireAt === null) continue;
			if (fireAt <= now) continue;

			// Local SW path - 24h window matches what the SW's polling can realistically cover.
			if (fireAt <= now + window24h) {
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

			// Server-side path - 7d window; bucketed fire_at means the server only
			// sees rounded-down 5-min marks. Skip if user opted out.
			if (options.backgroundDelivery !== false && fireAt <= now + window7d) {
				const bucketed = Math.floor(fireAt / SERVER_SCHEDULE_BUCKET_MS) * SERVER_SCHEDULE_BUCKET_MS;
				serverItems.push({
					task_id: task.id,
					fire_at: new Date(bucketed).toISOString()
				});
			}
		}

		// Best-effort server sync. backgroundDelivery=false sends an empty list
		// so any previously-registered schedules are actively cleared (the OFF
		// state must not leave stale rows the cron would still wake on). Errors
		// logged but never bubble - local SW path is the always-on safety net.
		// We do mirror the outcome into `pushSyncError` so /settings/notifications
		// can surface a banner; without it the user has no way to tell their
		// schedules silently stopped registering.
		try {
			await this.syncServerSchedule(
				options.backgroundDelivery !== false ? serverItems : []
			);
			pushSyncError.set(null);
		} catch (error) {
			logger.warn('Failed to sync server-side push schedule:', error);
			pushSyncError.set(error instanceof Error ? error.message : 'Unknown sync error');
		}
	}

	/** Cancel a single scheduled notification on the SW (local path only). */
	async cancelNotification(taskId: string): Promise<void> {
		if (!this.isSupported()) return;
		const sw = await navigator.serviceWorker.ready;
		sw.active?.postMessage({ type: 'CANCEL_NOTIFICATION', taskId });
	}

	/**
	 * Cancel a single task's pending server-side schedule rows. Useful when
	 * a task is completed/deleted - lets us drop the schedule eagerly instead
	 * of waiting for the next full re-sync (which would naturally remove it
	 * via the replace-all POST).
	 */
	async cancelServerSchedule(taskId: string): Promise<void> {
		const accessToken = localStorage.getItem('access_token');
		if (!accessToken) return;
		try {
			await fetch(`${PUBLIC_BASE_PATH}/api/notifications/schedule`, {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`
				},
				body: JSON.stringify({ task_id: taskId })
			});
		} catch (error) {
			logger.warn('cancelServerSchedule failed:', error);
		}
	}

	/**
	 * Trigger a test notification immediately to verify the end-to-end pipeline
	 * (permission → service worker → system notification center).
	 *
	 * Uses registration.showNotification() from the main thread instead of
	 * postMessage to the SW - this way the call is awaitable and doesn't
	 * depend on the SW staying alive long enough to handle the message.
	 */
	async sendTestNotification(body: string): Promise<boolean> {
		if (!this.isSupported() || Notification.permission !== 'granted') return false;
		try {
			const registration = await navigator.serviceWorker.ready;
			await registration.showNotification('re/task', {
				body,
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
			logger.warn('No access token - cannot save push subscription to server');
			return;
		}

		const json = subscription.toJSON();

		// Encrypt parsed UA label instead of sending raw navigator.userAgent
		let deviceInfoEncrypted: string | null = null;
		if (cryptoManager.isInitialized()) {
			try {
				deviceInfoEncrypted = await cryptoManager.encryptText(parseUserAgent(navigator.userAgent));
			} catch {
				// Non-critical - send null
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

	/**
	 * Replace-all push schedule on the server for the current subscription.
	 * Idempotent - safe to call as often as you like; server discards the
	 * previous unsent rows and inserts the current list.
	 *
	 * Skipped silently when the user has no active subscription (subscribe
	 * has not been called yet) or no access token (logged out).
	 */
	private async syncServerSchedule(
		items: { task_id: string; fire_at: string }[]
	): Promise<void> {
		const accessToken = localStorage.getItem('access_token');
		if (!accessToken) return;

		const subscription = await this.getSubscription();
		if (!subscription) return;

		const res = await fetch(`${PUBLIC_BASE_PATH}/api/notifications/schedule`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`
			},
			body: JSON.stringify({
				endpoint: subscription.endpoint,
				items
			})
		});

		if (!res.ok) {
			throw new Error(`Schedule sync failed: ${res.status}`);
		}
	}

	private async removeSubscriptionFromServer(endpoint: string): Promise<void> {
		const accessToken = localStorage.getItem('access_token');
		if (!accessToken) {
			logger.warn('No access token - cannot remove push subscription from server');
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

/**
 * Compare a subscription's `applicationServerKey` to the current server VAPID
 * public key. Returns false (treat as mismatch) when the subscription has no
 * stored key - safer to re-subscribe than to silently keep a sub the push
 * service might reject.
 */
function subscriptionMatchesVapidKey(
	subscription: PushSubscription,
	vapidKey: string
): boolean {
	const stored = subscription.options.applicationServerKey;
	if (!stored) return false;

	const expected = urlBase64ToUint8Array(vapidKey);
	const actual = new Uint8Array(stored as ArrayBuffer);
	if (expected.length !== actual.length) return false;
	for (let i = 0; i < expected.length; i++) {
		if (expected[i] !== actual[i]) return false;
	}
	return true;
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
