/**
 * The two secrets a native shell keeps in the device credential store, built
 * on any {@link NativeSecureStorage} (the Capacitor plugin on the phones, the
 * shell's own store on desktop - the app passes the getter for its build).
 *
 * - The session **refresh token**: the native shell cannot ride the web's
 *   cross-origin httpOnly cookie (a `SameSite=Lax` cookie is never sent
 *   cross-site), so the token lives here and travels in request bodies
 *   (`/api/auth/refresh-native`, Faza 2).
 * - The **master key** (raw Base64), persisted through the `MasterKeyVault`
 *   the app injects into `cryptoManager` (Faza 3c). Only the
 *   Keystore/Keychain-wrapped ciphertext touches disk; the wrapping key is
 *   non-extractable and never leaves the device (it does not ride app
 *   backups - on iOS thanks to `whenUnlockedThisDeviceOnly`, see
 *   `./secure-storage.ts`), so a restored device falls back to password
 *   unlock.
 *
 * The master key is never written anywhere else on a native shell, and never
 * leaves the device unencrypted.
 *
 * Errors from the storage layer (rare OS failures, a bridge timeout) are
 * swallowed and degrade to "no value": a missing token surfaces as an expired
 * session (re-login), a missing key as the password unlock screen - and a
 * successful unlock re-writes the entry. Nothing here throws out of the auth
 * or unlock flow.
 *
 * Flag-free on purpose: the apps call these only behind `__REBORN_NATIVE__`,
 * which keeps the web build free of them (and of the storage plugin).
 */

import type { NativeSecureStorage } from '../types';

/** Resolves the credential store of the running shell. May reject. */
export type SecureStorageGetter = () => Promise<NativeSecureStorage>;

const REFRESH_TOKEN_KEY = 'refresh_token';
const MASTER_KEY_KEY = 'master_key';

/** Persist the (rotated) refresh token after login / refresh. Ignores an empty token. */
export async function persistRefreshToken(
  getStorage: SecureStorageGetter,
  token: string | null | undefined
): Promise<void> {
  if (!token) return;
  try {
    const storage = await getStorage();
    await storage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // Write failed (rare OS error). The current access token is still valid for
    // its lifetime; the next refresh will find no usable token and prompt re-login.
  }
}

/** Read the persisted refresh token, or null if none / on error. */
export async function readRefreshToken(getStorage: SecureStorageGetter): Promise<string | null> {
  try {
    const storage = await getStorage();
    return await storage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Remove the persisted refresh token (logout). Best-effort. */
export async function clearRefreshToken(getStorage: SecureStorageGetter): Promise<void> {
  try {
    const storage = await getStorage();
    await storage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Best-effort on logout - a failed delete must not block the logout flow.
  }
}

/**
 * Structural twin of `MasterKeyVault` from `@reborn/crypto` (kept structural
 * so this package stays free of a crypto dependency; TypeScript checks the
 * match where the app passes it to `cryptoManager.setMasterKeyVault`).
 */
export interface SecureMasterKeyVault {
  save(rawKeyBase64: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

/**
 * Device-backed master-key vault. Wire it only on native builds: on web a
 * vault would silently replace the IndexedDB persistence path.
 */
export function createSecureStorageMasterKeyVault(
  getStorage: SecureStorageGetter
): SecureMasterKeyVault {
  return {
    async save(rawKeyBase64: string): Promise<void> {
      try {
        const storage = await getStorage();
        await storage.setItem(MASTER_KEY_KEY, rawKeyBase64);
      } catch {
        // Write failed (rare OS error). The in-memory key keeps this session
        // working; the next cold start falls back to the unlock screen.
      }
    },

    async load(): Promise<string | null> {
      try {
        const storage = await getStorage();
        return await storage.getItem(MASTER_KEY_KEY);
      } catch {
        return null;
      }
    },

    async clear(): Promise<void> {
      try {
        const storage = await getStorage();
        await storage.removeItem(MASTER_KEY_KEY);
      } catch {
        // Best-effort on logout - a failed delete must not block the flow.
      }
    }
  };
}
