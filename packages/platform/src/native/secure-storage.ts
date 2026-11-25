/**
 * Raw-bridge access to the native SecureStorage plugin
 * (`@aparajita/capacitor-secure-storage`; Faza 4, D1 + iOS fix).
 *
 * Talks DIRECTLY to the natively-registered plugin via Capacitor's
 * `registerPlugin('SecureStorage')` proxy - the `internal*` methods live in
 * the plugin's native method header, so every call is a straight bridge
 * round-trip. The package's JS convenience layer is deliberately NOT
 * imported: its lazy platform factory (a nested dynamic import resolved on
 * first method call) wedged during iOS cold start (Faza 4 smoke: the
 * boot-time vault read never reached the bridge, the pending promise
 * poisoned the memo, and every later caller - 2FA login included - hung
 * forever on it). The raw proxy has no factory and no nested import; it is
 * the exact path that kept answering from the Web Inspector console while
 * the app hung.
 *
 * On-disk compatibility: this mirrors the JS layer's `setItem`/`getItem`/
 * `removeItem` (string variants) byte for byte - `capacitor-storage_` key
 * prefix, raw string payload (no JSON wrapping), `sync: false` - so entries
 * written by earlier builds (Faza 2/3c Android) read back unchanged.
 *
 * iOS Keychain semantics (D1): every write passes
 * `access: whenUnlockedThisDeviceOnly` and `sync: false` PER CALL (the Swift
 * side reads both per operation), replacing the JS layer's global
 * `setDefaultKeychainAccess`/`setSynchronize` configuration. `ThisDeviceOnly`
 * keeps the entry out of encrypted-backup migration - the documented
 * no-backup-ride guarantee; Android ignores both options (Keystore gives the
 * guarantee by construction). Constant locked to the plugin enum by a unit
 * test.
 *
 * Resilience: every operation is raced against a timeout. A timeout rejects
 * into the caller's existing degrade path (vault load -> null -> password
 * unlock; token persist -> skip) - a transient wedge can cost one degraded
 * attempt, never the whole session.
 *
 * `@capacitor/core` is imported STATICALLY, not dynamically: the cold-start
 * vault read is the first thing that touches this module, and dynamic chunk
 * imports during the iOS boot storm are exactly what wedged before (second
 * occurrence: kill/reopen landed on the password screen because the
 * boot-time `import('@capacitor/core')` stalled past the timeout, while the
 * warm refresh-token read later succeeded). On native, core is already in
 * the boot bundle so the static import adds nothing; on web the apps only
 * reach `createCapacitorSecureStorage` behind the compile-time-false
 * `__REBORN_NATIVE__` guard, so it is tree-shaken from the web bundle.
 */

import { registerPlugin } from '@capacitor/core';
import type { NativeSecureStorage } from '../types';

/** Key prefix the plugin's JS layer applies; baked into existing entries. */
const KEY_PREFIX = 'capacitor-storage_';

/**
 * `KeychainAccess.whenUnlockedThisDeviceOnly` from the plugin's enum,
 * duplicated as a literal so the wedging JS module stays unimported at
 * runtime. Locked by `secure-storage.spec.ts` against the package.
 */
export const KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY = 1;

/** Per-operation ceiling; generous for a local bridge round-trip. */
const OP_TIMEOUT_MS = 6000;

/** The plugin's native method surface (see its ios/android sources). */
interface RawSecureStoragePlugin {
  internalSetItem(options: {
    prefixedKey: string;
    data: string;
    sync: boolean;
    access: number;
  }): Promise<void>;
  internalGetItem(options: {
    prefixedKey: string;
    sync: boolean;
  }): Promise<{ data: string | null }>;
  internalRemoveItem(options: {
    prefixedKey: string;
    sync: boolean;
  }): Promise<{ success: boolean }>;
}

function withTimeout<T>(operation: Promise<T>, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`secure-storage ${name} timed out after ${OP_TIMEOUT_MS}ms`)),
      OP_TIMEOUT_MS
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

let rawPlugin: RawSecureStoragePlugin | null = null;

/**
 * The Keychain / Keystore facade of a Capacitor shell. Call only in a
 * Capacitor build - the apps gate it on `__REBORN_NATIVE__` (and pick the
 * desktop shell's own store under `__REBORN_DESKTOP__`).
 */
export function createCapacitorSecureStorage(): NativeSecureStorage {
  // registerPlugin is synchronous (it builds a proxy over the already-injected
  // native bridge) - no async init step is left that a boot race could wedge.
  rawPlugin ??= registerPlugin<RawSecureStoragePlugin>('SecureStorage');
  const raw = rawPlugin;
  return {
    async setItem(key: string, value: string): Promise<void> {
      await withTimeout(
        raw.internalSetItem({
          prefixedKey: KEY_PREFIX + key,
          data: value,
          sync: false,
          access: KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY
        }),
        'setItem'
      );
    },

    async getItem(key: string): Promise<string | null> {
      const { data } = await withTimeout(
        raw.internalGetItem({ prefixedKey: KEY_PREFIX + key, sync: false }),
        'getItem'
      );
      return data ?? null;
    },

    async removeItem(key: string): Promise<void> {
      await withTimeout(
        raw.internalRemoveItem({ prefixedKey: KEY_PREFIX + key, sync: false }),
        'removeItem'
      );
    }
  };
}
