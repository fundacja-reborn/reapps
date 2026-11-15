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
 *  - what to flush before the key disappears (the open note, pending settings)
 *  - how to leave the unlocked UI (a hard navigation, so the JS context with
 *    its decrypted stores, editor buffer and undo history is destroyed)
 *  - enable / disable, which verify the account password against the wrap in
 *    the credentials record
 *
 * Native builds use the biometric App Lock instead (app-lock.service.ts); the
 * crypto layer keeps the web lock inert there and `initWebLock` is a no-op.
 */

import { base } from '$app/paths';
import {
  cryptoManager,
  createWebLockController,
  type WebLockController
} from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { toast, type WebLockChangeResult } from '@reborn/ui';
import { get } from 'svelte/store';
import { t } from '$lib/stores/i18n.store';
import { authStore, CREDENTIALS_KEY } from '$lib/stores/auth.store';
import { goto } from '$lib/utils/navigation';

const logger = createLogger('WebLock');

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
 * Save what would otherwise be lost with the key: the note being edited and a
 * settings change still waiting for its debounced push. Runs while encryption
 * still works; the controller bounds it in time.
 */
async function flushBeforeLock(): Promise<boolean> {
  const [{ noteDetailService }, { syncedSettings }] = await Promise.all([
    import('$lib/services/note-detail.service.svelte'),
    import('$lib/services/synced-settings.service')
  ]);
  const [saved] = await Promise.allSettled([
    noteDetailService.flushPendingSave(),
    navigator.onLine ? syncedSettings.pushNow() : Promise.resolve()
  ]);
  // `false` = the open item could not be saved (over its size limit, storage
  // error). A manual lock is then called off rather than dropping the text.
  return !(saved.status === 'fulfilled' && saved.value === false);
}

/**
 * Leave the unlocked UI for the unlock screen with a full page load. The page
 * is emptied first so that a later restore from the back/forward cache cannot
 * show what was on screen before the lock.
 */
function leaveForUnlock(): void {
  try {
    document.body.replaceChildren();
  } catch {
    // Best effort - the navigation below replaces the page either way.
  }
  window.location.replace(`${base}/auth/unlock`);
}

/**
 * Another tab handed this locked tab the key (it is already in memory). Mark
 * the session unlocked - the root layout then re-hydrates the stores - and
 * leave the unlock screen with an in-app navigation: a page load would drop
 * the memory-only key again.
 */
function adoptPeerUnlock(): void {
  authStore.markE2EUnlocked();
  if (window.location.pathname.startsWith(`${base}/auth/unlock`)) {
    void goto('/');
  }
}

/** Start the lock controller. Called once from the root layout on web. */
export function initWebLock(): void {
  if (__REBORN_NATIVE__ || controller) return;
  controller = createWebLockController({
    onBeforeLock: flushBeforeLock,
    onLocked: leaveForUnlock,
    onUnlockedByPeer: adoptPeerUnlock
  });
  controller.start();
}

/** Whether the Web App Lock is on for this session (synchronous). */
export function isWebLockEnabled(): boolean {
  return !__REBORN_NATIVE__ && cryptoManager.isWebLockEnabled();
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
