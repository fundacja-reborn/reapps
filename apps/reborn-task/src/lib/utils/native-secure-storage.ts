/**
 * The device credential store of the re/task shell: the Capacitor
 * SecureStorage raw bridge (`createCapacitorSecureStorage` in
 * `@reborn/platform/native` - iOS Keychain `whenUnlockedThisDeviceOnly`,
 * Android Keystore, per-operation timeouts; the boot-wedge rationale lives
 * there).
 *
 * Every native secret goes through here: the refresh token
 * (`native-auth-storage.ts`) and the master-key vault
 * (`native-master-key-vault.ts`). Never import the plugin package directly
 * (iOS boot wedge, guideline 61).
 *
 * On web the body is dead code (`__REBORN_NATIVE__` is a build-time `false`),
 * so neither the bridge nor the plugin reaches the web bundle.
 */
import type { NativeSecureStorage } from '@reborn/platform';
import { createCapacitorSecureStorage } from '@reborn/platform/native';

/** Load the secure-storage facade of this shell. Rejects on web builds. */
export async function getSecureStorage(): Promise<NativeSecureStorage> {
	if (!__REBORN_NATIVE__) {
		throw new Error('secure storage is native-only');
	}
	return createCapacitorSecureStorage();
}
