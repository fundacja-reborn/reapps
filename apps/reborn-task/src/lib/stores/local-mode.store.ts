import { writable } from 'svelte/store';
import { browser } from '$app/environment';

/**
 * Local-only / no-account mode primitives for Reborn Task.
 *
 * The on/off marker and the device-scoped user id live in localStorage under
 * the SAME keys as reborn-notes, so entering local mode in one app is visible
 * to the other on the same origin (cross-app SSO), exactly like
 * `reborn_auth_credentials`. See planning/local-only-no-account-plan.md.
 *
 * `localOnly` is a one-way writable set by `authOperationsService`
 * (enterLocalMode / boot restore / upgrade / login) so the sync layer can gate
 * itself without importing the auth store - mirrors reborn-notes' `localOnly`
 * and avoids an auth <-> sync import cycle.
 */

export const LOCAL_MODE_KEY = 'reborn_local_mode';
export const LOCAL_USER_ID_KEY = 'reborn_local_user_id';

/**
 * True in local-only / no-account mode. Read synchronously by the sync service
 * (`get(localOnly)`) to no-op every server round-trip - there is no session.
 */
export const localOnly = writable(false);

/** v4-shaped UUID matcher - mirrors the shape idb-cleanup's repairUserId expects. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read or lazily create the device-scoped local user id. Used as `user_id` for
 * records created in local-only mode so FK-shaped fields and shadow-index
 * repair keep working before any server account exists.
 */
export function getOrCreateLocalUserId(): string {
	const existing = localStorage.getItem(LOCAL_USER_ID_KEY);
	if (existing && UUID_RE.test(existing)) return existing;
	const id = crypto.randomUUID();
	localStorage.setItem(LOCAL_USER_ID_KEY, id);
	return id;
}

/**
 * Synchronous snapshot of the persisted local-mode markers. A real account
 * session always wins over the marker, so callers must check for credentials
 * first (the boot path in `initializeAuth` does exactly that).
 */
export function readLocalModeFromStorage(): { active: boolean; userId: string | null } {
	if (!browser) return { active: false, userId: null };
	const active = localStorage.getItem(LOCAL_MODE_KEY) === '1';
	const userId = localStorage.getItem(LOCAL_USER_ID_KEY);
	return { active: active && !!userId && UUID_RE.test(userId), userId };
}

/** Clear the local-mode markers (called when upgrading to / logging into an account). */
export function clearLocalModeMarkers(): void {
	if (!browser) return;
	localStorage.removeItem(LOCAL_MODE_KEY);
	localStorage.removeItem(LOCAL_USER_ID_KEY);
}
