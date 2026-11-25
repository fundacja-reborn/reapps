/**
 * Native master-key vault for re/task: the device-backed vault shared with
 * re/notes (`@reborn/platform/native`) over the shell's credential store
 * (iOS Keychain / Android Keystore-wrapped).
 *
 * Injected into the CryptoManager from `hooks.client.ts` (native builds only)
 * so the master key is never persisted as an extractable CryptoKey in
 * IndexedDB nor as a raw Base64 export in sessionStorage; kill / reopen then
 * restores it without the password. Wire it only under `__REBORN_NATIVE__`:
 * on web a vault would silently replace the IndexedDB persistence path.
 * Storage errors degrade to "no key" (password unlock).
 */
import type { MasterKeyVault } from '@reborn/crypto';
import { createSecureStorageMasterKeyVault } from '@reborn/platform/native';
import { getSecureStorage } from './native-secure-storage';

/** Create the device-backed master-key vault. Call only when `__REBORN_NATIVE__`. */
export function createNativeMasterKeyVault(): MasterKeyVault {
	return createSecureStorageMasterKeyVault(getSecureStorage);
}
