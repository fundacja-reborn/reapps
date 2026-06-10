/**
 * Shared loader for `@aparajita/capacitor-secure-storage` that guarantees the
 * iOS Keychain is configured BEFORE any operation goes through (Faza 4, D1):
 *
 * - `setDefaultKeychainAccess(whenUnlockedThisDeviceOnly)`: the plugin default
 *   (`whenUnlocked`) lets Keychain items migrate to a NEW device inside
 *   encrypted iOS backups. Our documented vault semantics ("the secret does
 *   not ride app backups; a restored device falls back to password unlock")
 *   hold on Android by Keystore construction - `ThisDeviceOnly` makes them
 *   hold on iOS too. `whenUnlocked` (vs `afterFirstUnlock`) suffices because
 *   Notes has no background processing on iOS (no push); revisit alongside
 *   native Task push if background access ever becomes a need.
 * - `setSynchronize(false)`: keep items out of iCloud Keychain. This matches
 *   the plugin default, but a security property must not hang on a library's
 *   implicit default.
 *
 * Both calls are documented no-ops on Android, so this path is unconditional
 * under `__REBORN_NATIVE__`. Configuration runs once (memoized) and every
 * accessor awaits it, so ordering never depends on startup timing. On a
 * configuration failure (rare OS error) the cached promise is dropped so the
 * next call retries, and the rejection propagates into the caller's existing
 * catch path - degrading to "no entry" (fail closed), never to writing with
 * the wrong Keychain class.
 *
 * The `__REBORN_NATIVE__` guard lives INSIDE the accessor: on the web build it
 * is a compile-time `false`, the dynamic import below becomes dead code, and
 * the plugin stays out of the web bundle (same DCE pattern as the previous
 * per-call-site imports).
 */

import type { SecureStoragePlugin } from '@aparajita/capacitor-secure-storage';

let configured: Promise<SecureStoragePlugin> | null = null;

/** Load and configure the secure-storage plugin. Rejects on web builds. */
export function getSecureStorage(): Promise<SecureStoragePlugin> {
  if (!__REBORN_NATIVE__) {
    return Promise.reject(new Error('secure storage is native-only'));
  }
  configured ??= (async () => {
    const { SecureStorage, KeychainAccess } = await import(
      '@aparajita/capacitor-secure-storage'
    );
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    await SecureStorage.setSynchronize(false);
    return SecureStorage;
  })().catch((error: unknown) => {
    configured = null;
    throw error;
  });
  return configured;
}
