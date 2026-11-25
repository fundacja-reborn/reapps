/**
 * The device credential store of this build: the Capacitor SecureStorage
 * raw bridge on the phones (`createCapacitorSecureStorage` in
 * `@reborn/platform/native` - Keychain access class, timeouts and the
 * boot-wedge rationale live there), the shell's own commands in the desktop
 * app (`desktop-secure-storage.ts`).
 *
 * Every native secret goes through here: the refresh token
 * (`native-auth-storage.ts`), the master-key vault
 * (`native-master-key-vault.ts`) and the auto-backup recovery phrase. Never
 * import the plugin package directly (iOS boot wedge, guideline 61).
 *
 * On web the whole body is dead code (`__REBORN_NATIVE__` is a build-time
 * `false`), so neither the bridge nor the plugin reaches the web bundle.
 */

import type { NativeSecureStorage } from '@reborn/platform';
import { createCapacitorSecureStorage } from '@reborn/platform/native';
import { getDesktopSecureStorage } from './desktop-secure-storage';

/** Load the secure-storage facade of this shell. Rejects on web builds. */
export async function getSecureStorage(): Promise<NativeSecureStorage> {
  if (!__REBORN_NATIVE__) {
    throw new Error('secure storage is native-only');
  }
  // Desktop (Tauri) shell: no Capacitor bridge exists there, so the raw plugin
  // proxy would reject every call. The OS credential store is reached through
  // the shell's own commands instead (same contract).
  if (__REBORN_DESKTOP__) {
    return getDesktopSecureStorage();
  }
  return createCapacitorSecureStorage();
}
