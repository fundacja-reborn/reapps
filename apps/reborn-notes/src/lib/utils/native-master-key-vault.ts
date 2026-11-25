/**
 * Native master-key vault for re/notes: the shared device-backed vault from
 * `@reborn/platform/native` over this build's credential store
 * (`getSecureStorage()` - iOS Keychain / Android Keystore-wrapped on the
 * phones, the OS store on desktop).
 *
 * Injected into the CryptoManager from `hooks.client.ts` (native builds only)
 * so the master key is never persisted as an extractable CryptoKey in
 * IndexedDB nor as a raw Base64 export in sessionStorage. Must only be wired
 * under `__REBORN_NATIVE__`: on web a vault would silently disable the
 * IndexedDB persistence path. Storage errors degrade to "no key" (password
 * unlock); see the package module.
 */

import type { MasterKeyVault } from '@reborn/crypto';
import { createSecureStorageMasterKeyVault } from '@reborn/platform/native';
import { getSecureStorage } from './native-secure-storage';

/** Create the device-backed master-key vault. Call only when `__REBORN_NATIVE__`. */
export function createNativeMasterKeyVault(): MasterKeyVault {
  return createSecureStorageMasterKeyVault(getSecureStorage);
}
