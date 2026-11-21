/**
 * Secure storage for the desktop (Tauri) shell: the OS credential store
 * (macOS Keychain, Windows Credential Manager) behind the shell's
 * `secure_storage_*` commands (`src-tauri/src/secure_storage.rs`).
 *
 * Same contract as the Capacitor facade in `native-secure-storage.ts`, which
 * hands this implementation out on desktop builds - so the refresh token
 * (`native-auth-storage.ts`) and the master-key vault
 * (`native-master-key-vault.ts`) work unchanged.
 *
 * No timeout, unlike the Capacitor path: the first access from a freshly
 * built, unsigned binary makes macOS ask the user for permission, and that
 * dialog can stay open for as long as the user needs.
 */

import { invokeDesktop } from './desktop-bridge';
import type { NativeSecureStorage } from './native-secure-storage';

export function getDesktopSecureStorage(): NativeSecureStorage {
  return {
    async setItem(key: string, value: string): Promise<void> {
      await invokeDesktop<null>('secure_storage_set', { key, value });
    },

    async getItem(key: string): Promise<string | null> {
      const value = await invokeDesktop<string | null>('secure_storage_get', { key });
      return value ?? null;
    },

    async removeItem(key: string): Promise<void> {
      await invokeDesktop<null>('secure_storage_remove', { key });
    }
  };
}
