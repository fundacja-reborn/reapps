/**
 * When the native shells re-plan task reminders (`native-reminders.ts`): the
 * same triggers as the web's Web Push sync in `hooks.client.ts`, with the
 * platform resume in place of `visibilitychange` (the webview does not fire
 * it reliably on an app switch, guideline 61).
 *
 * - the decrypted task store changes (edits here, a sync pull, unlock),
 * - the settings change (on / off, lead time, all-day time, language, clock),
 * - the app comes back to the foreground (the user may have changed the
 *   notification or exact-alarm permission in the system settings),
 * - every 15 minutes while open (moves the 60-reminder window forward).
 *
 * All of them go through one 1 s debounce: the first sync pull fans out many
 * store updates, and an unchanged plan is skipped by the planner anyway.
 */

import { get } from 'svelte/store';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import {
	DEFAULT_NOTIFICATION_ALL_DAY_TIME,
	DEFAULT_NOTIFICATION_LEAD_MINUTES
} from '$lib/services/reminder-schedule';
import { syncNativeReminders } from '$lib/services/native-reminders';

const logger = createLogger('NativeReminderSync');

const DEBOUNCE_MS = 1000;
const INTERVAL_MS = 15 * 60 * 1000;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let replan: (() => Promise<void>) | null = null;

/** Re-plan soon (debounced). A no-op before {@link startNativeReminderSync}. */
export function requestNativeReminderReplan(): void {
	if (!__REBORN_NATIVE__ || !replan) return;
	if (timer !== null) clearTimeout(timer);
	const run = replan;
	timer = setTimeout(() => {
		timer = null;
		void run();
	}, DEBOUNCE_MS);
}

/** Wire the triggers once, after storage is up. Never throws. */
export async function startNativeReminderSync(): Promise<void> {
	if (!__REBORN_NATIVE__ || started) return;
	started = true;
	try {
		const [{ tasks }, { appSettings }, { getSetting }, { platform }] = await Promise.all([
			import('$lib/stores/decrypted-tasks.store'),
			import('$lib/stores/app-settings.store'),
			import('$lib/utils/app-settings'),
			import('$lib/platform')
		]);

		replan = async () => {
			try {
				const enabled = (await getSetting('notifications_enabled')) ?? false;
				// Locked is not "no tasks": without the master key the decrypted
				// store is empty, and planning from it would cancel every reminder.
				// Logout and wipes cancel explicitly (cancelNativeReminders).
				if (enabled && !cryptoManager.isInitialized()) return;
				await syncNativeReminders({
					enabled,
					tasks: get(tasks),
					options: {
						leadMinutes:
							(await getSetting('notification_lead_minutes')) ?? DEFAULT_NOTIFICATION_LEAD_MINUTES,
						allDayTime:
							(await getSetting('notification_all_day_time')) ?? DEFAULT_NOTIFICATION_ALL_DAY_TIME
					}
				});
			} catch (err: unknown) {
				logger.warn('Native reminder re-plan failed:', err);
			}
		};

		tasks.subscribe(() => requestNativeReminderReplan());
		appSettings.subscribe(() => requestNativeReminderReplan());
		platform.lifecycle.onResume(() => requestNativeReminderReplan());
		setInterval(() => requestNativeReminderReplan(), INTERVAL_MS);
		logger.info('Native reminder sync registered');
	} catch (err: unknown) {
		logger.error('Failed to register native reminder sync:', err);
	}
}
