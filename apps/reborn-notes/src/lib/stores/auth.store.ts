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
import { API_BASE } from '$lib/utils/api-base';
import { clearNativeRefreshToken } from '$lib/utils/native-auth-storage';
import { clearNativeSessionId } from '$lib/utils/native-session';
import { cryptoManager } from '@reborn/crypto';
import { sessionExpired, localOnly } from '$lib/stores/sync-status.store';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-AuthStore');

export const CREDENTIALS_KEY = 'reborn_auth_credentials';
export const ACCESS_TOKEN_KEY = 'access_token';

// Local-only mode (no account / offline-only). Shared across Notes and Task on
// the same origin, exactly like CREDENTIALS_KEY, so entering local mode in one
// app is visible to the other. `LOCAL_MODE_KEY` is the on/off marker;
// `LOCAL_USER_ID_KEY` holds a device-scoped UUID used as the `user_id` of local
// records (keeps FK-shaped fields + shadow-index repair valid before any
// account exists). See planning/local-only-no-account-plan.md.
export const LOCAL_MODE_KEY = 'reborn_local_mode';
export const LOCAL_USER_ID_KEY = 'reborn_local_user_id';

export interface AuthState {
  /** `null` when unauthenticated (redirected to login) or in local-only mode. */
  username: string | null;
  userId: string | null;
  accessToken: string | null;
  /** True only with a real server account session. False in local-only mode. */
  isAuthenticated: boolean;
  /**
   * True in local-only / no-account mode: the app is usable and encrypted
   * locally, but there is no server session, so sync never runs. Distinct from
   * `isAuthenticated` precisely so the existing sync gates stay no-ops here.
   */
  isLocalOnly: boolean;
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
    isLocalOnly: false,
    createdAt: null,
    hasE2E: false
  };
  if (!browser) return empty;
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (raw) {
      // Duck-type the stored AuthCredentials (avoids adding @reborn/auth dep)
      const creds = JSON.parse(raw) as {
        id: string;
        user_profile: { username: string; created_at?: string };
      };
      if (creds?.id && creds.user_profile?.username) {
        return {
          username: creds.user_profile.username,
          userId: creds.id,
          accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
          isAuthenticated: true,
          isLocalOnly: false,
          createdAt: creds.user_profile.created_at ?? null,
          // Key may already be in memory (restored from sessionStorage by CryptoManager singleton)
          hasE2E: cryptoManager.isInitialized()
        };
      }
    }

    // No account session: fall back to local-only mode if the marker is set.
    // A real account always wins over the local marker, so this branch is
    // reached only when there are no valid credentials.
    if (localStorage.getItem(LOCAL_MODE_KEY) === '1') {
      const localUserId = localStorage.getItem(LOCAL_USER_ID_KEY);
      if (localUserId) {
        return {
          username: null,
          userId: localUserId,
          accessToken: null,
          isAuthenticated: false,
          isLocalOnly: true,
          createdAt: null,
          hasE2E: cryptoManager.isInitialized()
        };
      }
    }

    return empty;
  } catch {
    return empty;
  }
}

/** v4-shaped UUID matcher - mirrors the shape idb-cleanup's repairUserId expects. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read or lazily create the device-scoped local user id. Used as `user_id` for
 * records created in local-only mode so FK-shaped fields and shadow-index
 * repair (idb-cleanup) keep working before any server account exists.
 */
function getOrCreateLocalUserId(): string {
  const existing = localStorage.getItem(LOCAL_USER_ID_KEY);
  if (existing && UUID_RE.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(LOCAL_USER_ID_KEY, id);
  return id;
}

function createAuthStore() {
  const { subscribe, set } = writable<AuthState>(readFromStorage());

  /**
   * Single write-path for the auth state. Mirrors `isLocalOnly` into the
   * `localOnly` sync-status store on EVERY update, so the footer ("Local only"
   * vs syncing) can never drift from the session. Without this, paths that call
   * `set()` but not `initialize()` - notably the 2FA login step, which only runs
   * `unlockE2E()` - left `localOnly` stuck `true` and the footer showed
   * "Local only" after a real login. One-way write (auth.store -> sync-status)
   * keeps the no-import-cycle invariant noted on `localOnly`.
   */
  function commit(next: AuthState): void {
    set(next);
    localOnly.set(next.isLocalOnly);
  }

  /**
   * Mark E2E as unlocked when the master key was loaded by another path —
   * cross-app SSO (peer Task/Notes already unlocked the shared origin IDB
   * key) or fast-path on `/auth/unlock`. Re-reads the auth credentials from
   * localStorage so other fields stay in sync.
   */
  function markE2EUnlocked(): void {
    if (!browser) return;
    if (!cryptoManager.isInitialized()) return;
    commit({ ...readFromStorage(), hasE2E: true });
  }

  /** Call once from the root layout to hydrate state and watch for cross-tab changes. */
  function initialize(): void {
    if (!browser) return;
    const initial = readFromStorage();
    commit(initial);
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
      commit(newState);
    });

    // Cross-app E2E unlock — peer app (Task) just unlocked the master key in
    // the shared origin IDB. Flip hasE2E and, if we're stuck on /auth/unlock,
    // hard-redirect home so the layout's $effect picks up sync. The matching
    // `cleared` event is a defense-in-depth backstop for `clearMasterKey()`
    // being called without touching credentials — the normal logout path
    // still goes through the storage listener above.
    cryptoManager.subscribeToKeyEvents((event) => {
      if (event === 'locked') {
        // Peer app locked the local passcode - lock here too. The key is
        // memory-only per browsing context, so clear ours and show the lock
        // screen (unless already on an auth route).
        cryptoManager.lockLocal({ broadcast: false });
        commit({ ...readFromStorage(), hasE2E: false });
        if (!window.location.pathname.includes('/auth/')) {
          window.location.href = `${base}/auth/lock`;
        }
        return;
      }
      if (event === 'unlocked') {
        if (!cryptoManager.isInitialized()) return;
        markE2EUnlocked();
        const path = window.location.pathname;
        if (path.includes('/auth/unlock')) {
          logger.info('Cross-app E2E unlock detected — redirecting from /auth/unlock to home');
          window.location.href = `${base}/`;
        }
        return;
      }
      // event === 'cleared'
      const stillAuthenticated = !!localStorage.getItem(CREDENTIALS_KEY);
      if (stillAuthenticated && !cryptoManager.isInitialized()) {
        logger.info('Cross-app key cleared without logout — flipping hasE2E to false');
        commit({ ...readFromStorage(), hasE2E: false });
      }
    });
  }

  /**
   * Enter local-only mode: usable, encrypted, no account, no sync. Generates a
   * device-scoped user id and a local master key (persisted at-rest by
   * CryptoManager - IndexedDB on web, Keychain/Keystore vault on native) when
   * one is not already loaded, then flips the store into local-only state.
   *
   * Returns false (no-op) if a real account session already exists - the
   * account always takes precedence. Returns true once local mode is active.
   */
  async function enterLocalMode(): Promise<boolean> {
    if (!browser) return false;
    // Never shadow a real account session.
    if (localStorage.getItem(CREDENTIALS_KEY)) return false;
    try {
      const localUserId = getOrCreateLocalUserId();
      localStorage.setItem(LOCAL_MODE_KEY, '1');

      // Generate + persist a local master key unless one is already loaded
      // (e.g. restored from IndexedDB/vault on a returning local session).
      // A local passcode wrap means the key is LOCKED behind a passcode, not
      // absent: generating a fresh key here would purge the wrap (setMasterKey)
      // and orphan every record encrypted under the real key. Refuse so the data
      // is recoverable - the caller routes to /auth/lock to unlock instead.
      if (!cryptoManager.isInitialized()) {
        if (cryptoManager.isLocalPasscodeEnabled()) {
          logger.warn(
            'Local passcode set but key locked - refusing to start a fresh local session (would orphan encrypted data)'
          );
          return false;
        }
        const key = await cryptoManager.generateMasterKey();
        await cryptoManager.setMasterKey(key);
      }

      commit({
        username: null,
        userId: localUserId,
        accessToken: null,
        isAuthenticated: false,
        isLocalOnly: true,
        createdAt: null,
        hasE2E: cryptoManager.isInitialized()
      });
      return true;
    } catch (err) {
      logger.error('Failed to enter local-only mode', err);
      return false;
    }
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
        commit({ ...readFromStorage(), hasE2E: true });
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
   * Unlock the local master key with the optional local passcode (local-only
   * mode). Decrypts the localStorage wrap into a memory-only key and flips
   * hasE2E. Returns false on a wrong passcode.
   */
  async function unlockLocalPasscode(passcode: string): Promise<boolean> {
    if (!browser) return false;
    const ok = await cryptoManager.unlockWithLocalPasscode(passcode);
    if (ok) commit({ ...readFromStorage(), hasE2E: true });
    return ok;
  }

  /** Lock the local passcode now: clears the in-memory key, shows the lock screen. */
  function lockLocalNow(): void {
    if (!browser) return;
    cryptoManager.lockLocal();
    commit({ ...readFromStorage(), hasE2E: false });
  }

  /**
   * Lock the native App Lock now: drop the in-memory key but KEEP the vault
   * entry (unlike logout), so a biometric unlock can re-read it. Flips hasE2E
   * so the guard routes to the biometric lock screen. Used by resume-after-
   * timeout and the manual "Lock now" action; unlock goes through the App Lock
   * service + markE2EUnlocked().
   */
  function lockAppNow(): void {
    if (!browser) return;
    cryptoManager.lockToVault();
    commit({ ...readFromStorage(), hasE2E: false });
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
  async function logout(): Promise<void> {
    if (!browser) return;
    // Reset session expired flag — this is an intentional logout, not expiry
    sessionExpired.set(false);
    localOnly.set(false);

    // Notify server to deactivate session (best-effort, fire-and-forget)
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers }).catch((err) => {
      logger.warn('Server logout call failed (non-critical):', err);
    });

    // Flush any pending E2E synced settings push before the master key is
    // cleared. Fire-and-forget — the hard redirect below races with this, but
    // the most common case (no pending push) returns immediately.
    if (navigator.onLine) {
      import('$lib/services/synced-settings.service')
        .then(({ syncedSettings }) => syncedSettings.pushNow())
        .catch((err) => logger.warn('Could not flush synced settings before logout:', err));
    }

    cryptoManager.clearMasterKey();
    // Drop the App Lock opt-in on logout: the vault is now empty, so leaving the
    // gate armed would strand the next account on a biometric lock screen with
    // no key to unlock. Re-enable is a one-tap opt-in after the next login.
    cryptoManager.setAppLockEnabled(false);
    localStorage.removeItem(CREDENTIALS_KEY);
    localStorage.removeItem(ACCESS_TOKEN_KEY);

    // Await the data-clearing steps BEFORE the hard redirect. window.location.href
    // reloads the page/WebView, which aborts any in-flight IndexedDB transaction —
    // a fire-and-forget clear here would race the reload and leave orphan notes
    // (seen on native when the next session points at a different backend). The
    // critical synchronous logout state (cleared localStorage + in-memory master
    // key above) is already applied, so callers see a logged-out state immediately;
    // only the redirect waits. Best-effort: failures are logged, never block logout.
    try {
      const { clearAllUserData } = await import('@reborn/storage');
      await clearAllUserData();
    } catch (err) {
      logger.error('Failed to clear IndexedDB on logout:', err);
    }
    // Native: drop the refresh token from secure storage (no-op on web; has its
    // own internal try/catch, so this never throws).
    await clearNativeRefreshToken();
    clearNativeSessionId();

    // Hard redirect — avoids reactive cascades from setting store to empty state.
    // Clearing localStorage above will also fire a storage event in reborn-task
    // (other tab), triggering its own hard redirect to login.
    window.location.href = `${base}/auth/login`;
  }

  return {
    subscribe,
    initialize,
    unlockE2E,
    unlockLocalPasscode,
    lockLocalNow,
    lockAppNow,
    logout,
    markE2EUnlocked,
    enterLocalMode
  };
}

export const authStore = createAuthStore();

/** Returns a user-displayable initial (first letter of username, uppercased). */
export function getUserInitial(username: string | null): string {
  return username ? username[0].toUpperCase() : '?';
}
