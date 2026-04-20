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

// How many minutes before due date to fire a reminder
const REMINDER_MINUTES_BEFORE = 60;

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
	 */
	async syncScheduledNotifications(tasks: TaskListItem[]): Promise<void> {
		if (!this.isSupported() || Notification.permission !== 'granted') return;

		const sw = await navigator.serviceWorker.ready;
		const now = Date.now();
		const window24h = 24 * 60 * 60 * 1000;

		// Cancel all existing scheduled reminders first
		sw.active?.postMessage({ type: 'CANCEL_ALL_NOTIFICATIONS' });

		for (const task of tasks) {
			if (task.is_completed || task.deleted_at || !task.due_date) continue;

			const dueMs = new Date(task.due_date).getTime();
			const fireAt = dueMs - REMINDER_MINUTES_BEFORE * 60 * 1000;

			// Only schedule if in the future and within 24 hours
			if (fireAt <= now || fireAt > now + window24h) continue;

			const body = task.has_time
				? `Termin: ${new Date(dueMs).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' })}`
				: 'Zbliża się termin zadania';

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
