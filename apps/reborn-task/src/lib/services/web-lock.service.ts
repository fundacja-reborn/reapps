/**
 * Web App Lock service (account sessions in the browser / PWA).
 *
 * Opt-in and off by default. While the lock is on, the master key lives in
 * tab memory only (see `@reborn/crypto`, "Web App Lock"): nothing unwrapped is
 * stored in the browser, so the account password is needed when the app is
 * opened and after the idle time the user picked. While one tab is unlocked
 * it hands the key to the others in memory, so they do not ask again.
 *
 * This module is the app-side glue around the shared controller:
 *  - what to flush before the key disappears (the open task, pending settings)
 *  - how to leave the unlocked UI (a hard navigation, so the JS context with
 *    its decrypted stores is destroyed), after telling the service worker to
 *    forget the reminder titles it holds in memory
 *  - enable / disable, which verify the account password against the wrap in
 *    the credentials record
 */

import { base } from '$app/paths';
import {
	cryptoManager,
	createWebLockController,
	type WebLockController
} from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { toast, type WebLockChangeResult } from '@reborn/ui';
import { authOperationsService } from '$lib/services/auth-operations.service';
import { get } from 'svelte/store';
import { t } from '$lib/stores/i18n.store';

const logger = createLogger('WebLock');

const CREDENTIALS_KEY = 'reborn_auth_credentials';

let controller: WebLockController | null = null;

/** The account's password-wrapped master key from the credentials record. */
function readAccountWrap(): { encryptedMasterKey: string; salt: string } | null {
	try {
		const raw = localStorage.getItem(CREDENTIALS_KEY);
		if (!raw) return null;
		const creds = JSON.parse(raw) as {
			encrypted_master_key?: string;
			master_key_salt?: string;
		};
		if (!creds.encrypted_master_key || !creds.master_key_salt) return null;
		return { encryptedMasterKey: creds.encrypted_master_key, salt: creds.master_key_salt };
	} catch {
		return null;
	}
}

/**
 * Save what would otherwise be lost with the key: the task being edited and a
 * settings change still waiting for its debounced push. Runs while encryption
 * still works; the controller bounds it in time.
 */
async function flushBeforeLock(): Promise<boolean> {
	const [{ taskDetailService }, { syncedSettings }] = await Promise.all([
		import('$lib/services/task-detail.service'),
		import('$lib/services/synced-settings.service')
	]);
	const [saved] = await Promise.allSettled([
		taskDetailService.flushPendingSave(),
		navigator.onLine ? syncedSettings.pushNow() : Promise.resolve()
	]);
	// `false` = the open item could not be saved (over its size limit, storage
	// error). A manual lock is then called off rather than dropping the text.
	return !(saved.status === 'fulfilled' && saved.value === false);
}

/**
 * Where to return after unlocking: the current in-app path, unless the tab is
 * already on an auth screen.
 */
function unlockUrl(): string {
	const path = window.location.pathname;
	const authPrefix = `${base}/auth`;
	if (path === base || path === `${base}/` || path.startsWith(authPrefix)) {
		return `${base}/auth/unlock`;
	}
	return `${base}/auth/unlock?returnTo=${encodeURIComponent(path)}`;
}

/**
 * Leave the unlocked UI for the unlock screen with a full page load.
 *
 * The service worker keeps the next 24 h of reminders, with task titles, in
 * its own memory - outside this page's JS context - so it is told to drop them
 * first. (Reminders woken by the server keep working while locked: without the
 * key the worker shows its generic text.) The page is emptied so that a later
 * restore from the back/forward cache cannot show what was on screen.
 */
function leaveForUnlock(): void {
	try {
		navigator.serviceWorker?.controller?.postMessage({ type: 'CANCEL_ALL_NOTIFICATIONS' });
	} catch {
		// No worker / messaging blocked: it holds nothing we can reach anyway.
	}
	const target = unlockUrl();
	try {
		document.body.replaceChildren();
	} catch {
		// Best effort - the navigation below replaces the page either way.
	}
	window.location.replace(target);
}

/**
 * Another tab handed this locked tab the key (it is already in memory). Mark
 * the session unlocked: the unlock page reacts to `hasE2E` and navigates to
 * its `returnTo` inside the app (a page load would drop the memory-only key
 * again), and the layouts load the data as after any unlock.
 */
function adoptPeerUnlock(): void {
	authOperationsService.getSessionManager().setSession({ hasE2E: true });
}

/** Start the lock controller. Called once on client start. */
export function initWebLock(): void {
	if (controller) return;
	controller = createWebLockController({
		onBeforeLock: flushBeforeLock,
		onLocked: leaveForUnlock,
		onUnlockedByPeer: adoptPeerUnlock
	});
	controller.start();
}

/** Whether the Web App Lock is on for this session (synchronous). */
export function isWebLockEnabled(): boolean {
	return cryptoManager.isWebLockEnabled();
}

/**
 * Lock every open tab of both apps now. When the open item cannot be saved
 * the lock is called off and the user is told, instead of losing the text.
 */
export async function lockWebNow(): Promise<void> {
	const locked = await controller?.lockNow();
	if (locked === false) {
		toast.error(get(t)('web_lock.lock_blocked'));
	}
}

/** Turn the lock on. The password must open the account wrap. */
export async function enableWebLock(password: string): Promise<WebLockChangeResult> {
	const wrap = readAccountWrap();
	if (!wrap) return 'error';
	try {
		const ok = await cryptoManager.enableWebLock({ password, ...wrap });
		if (!ok) return 'invalid_password';
		controller?.refresh();
		return 'ok';
	} catch (err: unknown) {
		logger.error('Failed to enable the Web App Lock:', err);
		return 'error';
	}
}

/** Turn the lock off. Asks for the password: the key is stored at rest again. */
export async function disableWebLock(password: string): Promise<WebLockChangeResult> {
	const wrap = readAccountWrap();
	if (!wrap) return 'error';
	try {
		const ok = await cryptoManager.disableWebLock({ password, ...wrap });
		if (!ok) return 'invalid_password';
		controller?.refresh();
		return 'ok';
	} catch (err: unknown) {
		logger.error('Failed to disable the Web App Lock:', err);
		return 'error';
	}
}

/** Change the idle timeout (ms; 0 = never lock on idle). */
export function setWebLockTimeout(timeoutMs: number): void {
	cryptoManager.setWebLockTimeoutMs(timeoutMs);
}
