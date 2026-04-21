/**
 * Auth store for Reborn Notes — SSO via shared localStorage.
 *
 * Both reborn-task and reborn-notes use the same localStorage keys
 * (`reborn_auth_credentials`, `access_token`). When served from the same origin
 * (production reverse proxy), the session is shared automatically: login once in
 * either app and the other app picks it up immediately.
 *
 * In development (different ports = different origins) the user must log in
 * separately in each app.
 *
 * E2E flow:
 *   1. User is authenticated (tokens in localStorage) but master key is not yet in memory.
 *   2. `/auth/unlock` asks for the password and calls `authStore.unlockE2E(password)`.
 *   3. `unlockE2E` decrypts the master key stored in `reborn_auth_credentials` and hands
 *      it to `cryptoManager`. From that point `hasE2E === true`.
 *   4. All note/folder/tag services use `cryptoManager.encryptText` / `decryptText`.
 *
 * Note: The app requires full authentication + E2E unlock to function.
 * Auth guard in +layout.svelte redirects unauthenticated users to /auth/login.
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { cryptoManager } from '@reborn/crypto';
import { sessionExpired } from '$lib/stores/sync-status.store';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-AuthStore');

export const CREDENTIALS_KEY = 'reborn_auth_credentials';
export const ACCESS_TOKEN_KEY = 'access_token';

export interface AuthState {
  /** `null` when unauthenticated (redirected to login). */
  username: string | null;
  userId: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  /** ISO date string of account creation. */
  createdAt: string | null;
  /** True when the master key is loaded in CryptoManager (E2E unlocked). */
  hasE2E: boolean;
}

/** Read auth state synchronously from localStorage. */
function readFromStorage(): AuthState {
  const empty: AuthState = {
    username: null,
    userId: null,
    accessToken: null,
    isAuthenticated: false,
    createdAt: null,
    hasE2E: false
  };
  if (!browser) return empty;
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return empty;
    // Duck-type the stored AuthCredentials (avoids adding @reborn/auth dep)
    const creds = JSON.parse(raw) as {
      id: string;
      user_profile: { username: string; created_at?: string };
    };
    if (!creds?.id || !creds.user_profile?.username) return empty;
    return {
      username: creds.user_profile.username,
      userId: creds.id,
      accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
      isAuthenticated: true,
      createdAt: creds.user_profile.created_at ?? null,
      // Key may already be in memory (restored from sessionStorage by CryptoManager singleton)
      hasE2E: cryptoManager.isInitialized()
    };
  } catch {
    return empty;
  }
}

function createAuthStore() {
  const { subscribe, set } = writable<AuthState>(readFromStorage());

  /** Call once from the root layout to hydrate state and watch for cross-tab changes. */
  function initialize(): void {
    if (!browser) return;
    set(readFromStorage());
    // Detect login / logout in other tabs on the same origin.
    // The `storage` event fires ONLY in other tabs/windows — never in the tab
    // that changed localStorage. This means:
    //  - Own logout → handled by logout() below (controlled flow)
    //  - Cross-app logout (e.g. Task logs out) → storage event → hard redirect
    //  - Cross-app login (e.g. Task logs in while Notes shows login page) → hard redirect to unlock
    window.addEventListener('storage', (e) => {
      if (e.key !== CREDENTIALS_KEY && e.key !== ACCESS_TOKEN_KEY) return;

      const newState = readFromStorage();
      if (!newState.isAuthenticated) {
        // Cross-app logout detected — hard redirect avoids reactive cascades
        // (empty stores, "?" avatar, effect_update_depth_exceeded).
        // Clear Notes IndexedDB BEFORE redirect so a subsequent login with
        // a different account can't reach decrypt with stale ciphertexts
        // encrypted under the previous user's master key (OperationError).
        logger.info('Cross-app logout detected via storage event — redirecting to login');
        sessionExpired.set(false);
        cryptoManager.clearMasterKey();
        import('@reborn/storage')
          .then(({ clearAllUserData }) => clearAllUserData())
          .catch((err) => logger.error('Failed to clear IndexedDB on cross-app logout:', err))
          .finally(() => {
            window.location.href = `${base}/auth/login`;
          });
        return;
      }

      // Cross-app login: credentials appeared (was absent, now present).
      // The master key lives only in the other app's memory, so the user must
      // enter their password here to decrypt it → redirect to E2E unlock.
      if (e.key === CREDENTIALS_KEY && e.oldValue === null) {
        logger.info('Cross-app login detected via storage event — redirecting to unlock');
        window.location.href = `${base}/auth/unlock`;
        return;
      }

      // Token refresh or other update — update store reactively
      set(newState);
    });
  }

  /**
   * Decrypt the master key with the user's password and mark E2E as unlocked.
   * The encrypted master key is read from `reborn_auth_credentials` in localStorage.
   * Returns `true` on success, `false` on wrong password.
   */
  async function unlockE2E(password: string): Promise<boolean> {
    if (!browser) return false;
    try {
      const raw = localStorage.getItem(CREDENTIALS_KEY);
      if (!raw) return false;
      const creds = JSON.parse(raw) as {
        encrypted_master_key?: string;
        master_key_salt?: string;
      };
      if (!creds.encrypted_master_key || !creds.master_key_salt) return false;

      const success = await cryptoManager.loadUserMasterKey(
        creds.encrypted_master_key,
        creds.master_key_salt,
        password
      );
      if (success) {
        // Re-read full state from localStorage — credentials may have been saved
        // before this call (e.g. 2FA page saves credentials, then calls unlockE2E).
        // Using readFromStorage() ensures isAuthenticated, username, userId etc.
        // are up-to-date, not stale from initial module import.
        set({ ...readFromStorage(), hasE2E: true });
        // Send encrypted device info to server (non-blocking, non-critical)
        import('$lib/services/device-info.service').then(({ sendEncryptedDeviceInfo }) =>
          // fire-and-forget: device info is non-critical
          sendEncryptedDeviceInfo().catch(() => {})
        );
      }
      return success;
    } catch {
      return false;
    }
  }

  /**
   * Clear all shared auth tokens and redirect to login.
   * Also clears the master key from memory (logs out of E2E too).
   * Because the tokens are shared, this also effectively logs the user out
   * of reborn-task on their next visit (storage event → hard redirect).
   *
   * Uses hard redirect (`window.location.href`) instead of Svelte store update
   * to avoid reactive cascades (empty stores, effect_update_depth_exceeded).
   */
  function logout(): void {
    if (!browser) return;
    // Reset session expired flag — this is an intentional logout, not expiry
    sessionExpired.set(false);

    // Notify server to deactivate session (best-effort, fire-and-forget)
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    fetch(`${base}/api/auth/logout`, { method: 'POST', headers }).catch((err) => {
      logger.warn('Server logout call failed (non-critical):', err);
    });

    cryptoManager.clearMasterKey();
    localStorage.removeItem(CREDENTIALS_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);

    // Clear all user data from IndexedDB to prevent cross-user data leakage.
    // Fire-and-forget — the hard redirect below will complete the logout even
    // if the clear takes a moment.
    import('@reborn/storage').then(({ clearAllUserData }) =>
      clearAllUserData().catch((err) => logger.error('Failed to clear IndexedDB on logout:', err))
    );

    // Hard redirect — avoids reactive cascades from setting store to empty state.
    // Clearing localStorage above will also fire a storage event in reborn-task
    // (other tab), triggering its own hard redirect to login.
    window.location.href = `${base}/auth/login`;
  }

  return { subscribe, initialize, unlockE2E, logout };
}

export const authStore = createAuthStore();

/** Returns a user-displayable initial (first letter of username, uppercased). */
export function getUserInitial(username: string | null): string {
  return username ? username[0].toUpperCase() : '?';
}
