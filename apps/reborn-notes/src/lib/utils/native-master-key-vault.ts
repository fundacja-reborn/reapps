/**
 * Native (Capacitor) master-key vault, backed by device secure storage
 * (iOS Keychain / Android Keystore-wrapped) via
 * `@aparajita/capacitor-secure-storage`.
 *
 * Injected into the CryptoManager from `hooks.client.ts` (native builds
 * only) so the master key is never persisted as an extractable CryptoKey in
 * IndexedDB nor as a raw Base64 export in sessionStorage. Only the
 * Keystore/Keychain-wrapped ciphertext touches disk; the wrapping key is
 * non-extractable and never leaves the device (it does not ride app
 * backups, so a restored device falls back to password unlock - same
 * semantics as the refresh token in `native-auth-storage.ts`). On iOS that
 * no-backup-ride guarantee is NOT the Keychain default - it comes from the
 * `whenUnlockedThisDeviceOnly` access class configured centrally in
 * `getSecureStorage()` (see `native-secure-storage.ts`).
 *
 * Plugin access goes through `getSecureStorage()`, which both gates on
 * `__REBORN_NATIVE__` (web builds dead-code-eliminate the plugin) and
 * guarantees the Keychain configuration above is applied before any
 * operation. The factory itself must also only be wired under
 * `__REBORN_NATIVE__`: on web a no-op vault would silently disable the
 * IndexedDB persistence path.
 *
 * Errors from the secure-storage layer (rare OS failures) are swallowed and
 * degrade to "no key": the user lands on the password unlock screen and a
 * successful unlock re-writes the entry (see `MasterKeyVault` contract).
 */

import type { MasterKeyVault } from '@reborn/crypto';
import { getSecureStorage } from './native-secure-storage';

const MASTER_KEY_KEY = 'master_key';

/** Create the device-backed master-key vault. Call only when `__REBORN_NATIVE__`. */
export function createNativeMasterKeyVault(): MasterKeyVault {
  return {
    async save(rawKeyBase64: string): Promise<void> {
      if (!__REBORN_NATIVE__) return;
      try {
        const storage = await getSecureStorage();
        await storage.setItem(MASTER_KEY_KEY, rawKeyBase64);
      } catch {
        // Write failed (rare OS error). The in-memory key keeps this session
        // working; the next cold start falls back to the unlock screen.
      }
    },

    async load(): Promise<string | null> {
      if (!__REBORN_NATIVE__) return null;
      try {
        const storage = await getSecureStorage();
        return await storage.getItem(MASTER_KEY_KEY);
      } catch {
        return null;
      }
    },

    async clear(): Promise<void> {
      if (!__REBORN_NATIVE__) return;
      try {
        const storage = await getSecureStorage();
        await storage.removeItem(MASTER_KEY_KEY);
      } catch {
        // Best-effort on logout - a failed delete must not block the flow.
      }
    }
  };
}
