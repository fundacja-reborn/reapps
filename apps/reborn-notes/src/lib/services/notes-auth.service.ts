/**
 * Client-side login helper for Reborn Notes.
 *
 * Calls the local /api/auth/login endpoint, saves credentials to localStorage
 * in the same format as reborn-task, then unlocks E2E via cryptoManager.
 * This allows Notes to authenticate users independently - without reborn-task.
 */
import { API_BASE } from '$lib/utils/api-base';
import { nativeAuthHeaders } from '$lib/utils/native-client';
import { persistNativeRefreshToken } from '$lib/utils/native-auth-storage';
import { authStore, CREDENTIALS_KEY, ACCESS_TOKEN_KEY } from '$lib/stores/auth.store';
import { sessionExpired } from '$lib/stores/sync-status.store';
import { clearAllUserData, isDatabaseInitialized } from '@reborn/storage';
import { createLogger } from '@reborn/utils';
import type { ReAuthResult } from '@reborn/ui';

const logger = createLogger('Notes-Auth');

export interface LoginResult {
  success: boolean;
  message?: string;
  twoFactorRequired?: boolean;
  userId?: string;
  encryptedMasterKey?: string;
  masterKeySalt?: string;
}

/** Minimal shape of the JSON body returned by the re-auth endpoints. */
interface ReAuthResponseBody {
  success?: boolean;
  error?: string;
  data?: {
    twoFactorRequired?: boolean;
    userId?: string;
    access_token?: string;
    /** Present only for native clients (sent the native header). */
    refresh_token?: string;
  };
}

/**
 * Log in with username + password.
 * On success: credentials are saved to localStorage (SSO-compatible with reborn-task),
 * E2E is unlocked, and the authStore is updated.
 */
export async function loginInNotes(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nativeAuthHeaders() },
      body: JSON.stringify({ username, password })
    });

    const body = await res.json();

    if (!res.ok || !body.success) {
      return { success: false, message: body.error || 'Login failed' };
    }

    const { data } = body;

    // 2FA required - return redirect info (password saved by caller via sessionStorage)
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
    // Web: refresh_token is managed exclusively via httpOnly cookie (set by server).
    // Native: it arrives in the body (native header) and is persisted to secure
    // storage for createAuthFetch's native refresh path. No-op on web.
    await persistNativeRefreshToken(data.refresh_token);

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

    // Unlock E2E using the same password - avoids a second prompt
    const unlocked = await authStore.unlockE2E(password);
    if (!unlocked) {
      // Credentials saved, but E2E failed - redirect to unlock page
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

/** Pull fresh data from server and refresh in-memory stores after re-auth. */
async function refreshAfterReauth(): Promise<void> {
  try {
    const { pullFromServer, refreshStoresAfterPull } = await import(
      '$lib/services/notes-sync.service'
    );
    const { verifyAndRebuildLocalShadowIndexes } = await import(
      '$lib/services/shadow-index-reconciler.service'
    );
    const synced = await pullFromServer();
    if (synced) {
      // Re-auth keeps IDB intact (offline-first), so any shadow-index drift
      // from the previous unlock-race window sits across the reauth boundary.
      // Run the reconciler before refreshing in-memory stores so the
      // post-pull noteIndex rebuild sees corrected pinned/starred flags.
      await verifyAndRebuildLocalShadowIndexes().catch(() => {});
      await refreshStoresAfterPull();
    }
  } catch {
    // Non-blocking - re-auth succeeded even if sync fails.
    // User can trigger manual sync via SyncStatusFooter.
  }
}

/**
 * Re-authenticate after session expiry - password step.
 *
 * Calls /api/auth/login to obtain new tokens. Master key in CryptoManager is
 * preserved (E2E access kept across session-expiry events).
 *
 * If the account has 2FA enabled the endpoint returns `twoFactorRequired: true`
 * without an access token - we propagate that to the caller so the UI can
 * collect a TOTP/recovery code and call {@link verifyTotpForReauth}.
 */
export async function reAuthenticate(password: string): Promise<ReAuthResult> {
  const credentialsRaw = localStorage.getItem(CREDENTIALS_KEY);
  if (!credentialsRaw) return { kind: 'error', message: 'Missing credentials' };

  let username: string;
  try {
    const parsed = JSON.parse(credentialsRaw);
    username = parsed.user_profile?.username;
    if (!username) return { kind: 'error', message: 'Missing username' };
  } catch {
    return { kind: 'error', message: 'Corrupted credentials' };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nativeAuthHeaders() },
      body: JSON.stringify({ username, password })
    });
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Network error' };
  }

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
    return { kind: 'locked', retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
  }

  if (res.status === 401) return { kind: 'invalid_password' };

  let body: ReAuthResponseBody;
  try {
    body = await res.json();
  } catch {
    return { kind: 'error', message: 'Invalid server response' };
  }

  if (!res.ok || !body?.success) {
    return { kind: 'error', message: body?.error };
  }

  const { data } = body;

  if (data?.twoFactorRequired) {
    if (!data.userId) return { kind: 'error', message: 'Missing userId in 2FA response' };
    return { kind: 'two_factor_required', userId: data.userId };
  }

  if (!data?.access_token) return { kind: 'error', message: 'Missing access token' };

  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  // Native: persist the rotated refresh token from the body. No-op on web.
  await persistNativeRefreshToken(data.refresh_token);

  // Credentials remain the same - touch to ensure they're still parseable
  try {
    localStorage.setItem(CREDENTIALS_KEY, credentialsRaw);
  } catch {
    /* keep existing */
  }

  sessionExpired.set(false);
  await refreshAfterReauth();
  return { kind: 'ok' };
}

/**
 * Re-authenticate after session expiry - TOTP step (invoked from ReAuthModal
 * after {@link reAuthenticate} returned `two_factor_required`).
 */
export async function verifyTotpForReauth(userId: string, code: string): Promise<ReAuthResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/2fa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nativeAuthHeaders() },
      body: JSON.stringify({ userId, code })
    });
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Network error' };
  }

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
    return { kind: 'locked', retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 };
  }

  let body: ReAuthResponseBody;
  try {
    body = await res.json();
  } catch {
    return { kind: 'error', message: 'Invalid server response' };
  }

  if (!res.ok || !body?.success) {
    // The server returns 400 for invalid codes - treat as invalid_totp so the
    // UI can show a code-specific error instead of the generic password one.
    if (res.status === 400) return { kind: 'invalid_totp' };
    return { kind: 'error', message: body?.error };
  }

  const { data } = body;
  if (!data?.access_token) return { kind: 'error', message: 'Missing access token' };

  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  // Native: persist the rotated refresh token from the body. No-op on web.
  await persistNativeRefreshToken(data.refresh_token);

  sessionExpired.set(false);
  await refreshAfterReauth();
  return { kind: 'ok' };
}
