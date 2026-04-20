/**
 * Client-side login helper for Reborn Notes.
 *
 * Calls the local /api/auth/login endpoint, saves credentials to localStorage
 * in the same format as reborn-task, then unlocks E2E via cryptoManager.
 * This allows Notes to authenticate users independently — without reborn-task.
 */
import { PUBLIC_BASE_PATH } from '$env/static/public';
import { authStore, CREDENTIALS_KEY, ACCESS_TOKEN_KEY } from '$lib/stores/auth.store';
import { sessionExpired } from '$lib/stores/sync-status.store';
import { clearAllUserData, isDatabaseInitialized } from '@reborn/storage';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-Auth');

export interface LoginResult {
  success: boolean;
  message?: string;
  twoFactorRequired?: boolean;
  userId?: string;
  encryptedMasterKey?: string;
  masterKeySalt?: string;
}

/**
 * Log in with username + password.
 * On success: credentials are saved to localStorage (SSO-compatible with reborn-task),
 * E2E is unlocked, and the authStore is updated.
 */
export async function loginInNotes(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${PUBLIC_BASE_PATH}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const body = await res.json();

    if (!res.ok || !body.success) {
      return { success: false, message: body.error || 'Login failed' };
    }

    const { data } = body;

    // 2FA required — return redirect info (password saved by caller via sessionStorage)
    if (data?.twoFactorRequired) {
      return {
        success: false,
        twoFactorRequired: true,
        userId: data.userId,
        encryptedMasterKey: data.encryptedMasterKey,
        masterKeySalt: data.masterKeySalt
      };
    }

    if (!data?.user || !data.access_token || !data.encryptedMasterKey) {
      return { success: false, message: 'Unexpected server response' };
    }

    // Save credentials in the same localStorage format as reborn-task
    // (snake_case field names match the AuthCredentials schema)
    const credentials = {
      id: data.user.id,
      encrypted_master_key: data.encryptedMasterKey,
      master_key_salt: data.masterKeySalt,
      user_profile: data.user
    };
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
    // Note: refresh_token is managed exclusively via httpOnly cookie (set by server)

    // Clear any previous user's data from IndexedDB before starting new session.
    // Prevents phantom notes when switching users or after DB wipe + re-register.
    if (isDatabaseInitialized()) {
      try {
        await clearAllUserData();
        logger.info('Cleared previous user data from IndexedDB');
      } catch (err) {
        logger.error('Failed to clear IndexedDB before login:', err);
      }
    }

    // Clear stale session-expired banner from a previous session
    sessionExpired.set(false);

    // Unlock E2E using the same password — avoids a second prompt
    const unlocked = await authStore.unlockE2E(password);
    if (!unlocked) {
      // Credentials saved, but E2E failed — redirect to unlock page
      authStore.initialize();
      return { success: true };
    }

    // Hydrate auth store with the new session
    authStore.initialize();
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'An error occurred. Please try again.'
    };
  }
}

/**
 * Re-authenticate after session expiry.
 * Calls login API to obtain new tokens, saves them to localStorage,
 * but does NOT clear the master key from CryptoManager (preserves E2E access).
 * Resets sessionExpired flag and triggers a sync pull.
 */
export async function reAuthenticate(password: string): Promise<boolean> {
  const credentials = localStorage.getItem(CREDENTIALS_KEY);
  if (!credentials) return false;

  let username: string;
  try {
    const parsed = JSON.parse(credentials);
    username = parsed.user_profile?.username;
    if (!username) return false;
  } catch {
    return false;
  }

  try {
    const res = await fetch(`${PUBLIC_BASE_PATH}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const body = await res.json();
    if (!res.ok || !body.success || !body.data?.access_token) return false;

    const { data } = body;

    // Update access token in localStorage (SSO-compatible)
    localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
    // Note: refresh_token is managed exclusively via httpOnly cookie (set by server)

    // Update credentials (keep existing master key + profile)
    try {
      const existing = JSON.parse(credentials);
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(existing));
    } catch {
      /* keep existing credentials */
    }

    // Clear session expired flag
    sessionExpired.set(false);

    // Pull fresh data from server and refresh in-memory stores.
    // Without refreshStoresAfterPull(), pullFromServer() only writes to IndexedDB
    // and the UI remains stale until a manual page reload.
    try {
      const { pullFromServer, refreshStoresAfterPull } = await import(
        '$lib/services/notes-sync.service'
      );
      const synced = await pullFromServer();
      if (synced) {
        await refreshStoresAfterPull();
      }
    } catch {
      // Non-blocking — re-auth succeeded even if sync fails.
      // User can trigger manual sync via SyncStatusFooter.
    }

    return true;
  } catch {
    return false;
  }
}
