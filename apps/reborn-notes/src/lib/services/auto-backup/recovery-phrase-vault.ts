/**
 * The recovery phrase, stored in device secure storage (iOS Keychain /
 * Android Keystore-wrapped) under a key SEPARATE from the master key.
 *
 * The phrase is the only secret protecting an automated backup: backups run
 * unattended, so the phrase must be readable without the user present, which
 * means it has to be at rest somewhere. The OS vault gives it exactly the master
 * key's protection - `whenUnlockedThisDeviceOnly`, no backup-ride - via the
 * shared `getSecureStorage()` (see `native-secure-storage.ts`). It is NEVER
 * written to `localStorage`/IndexedDB and NEVER sent to the server. The user
 * also records it out of band (the recovery kit) so a restore is possible on a
 * fresh device/account where this vault does not have it.
 *
 * Native-only: web has no equivalent vault, which is one reason real automated
 * backup is native-only (web export stays manual, with the user typing the
 * phrase). On web every function is a no-op / null.
 */

import { getSecureStorage } from '$lib/utils/native-secure-storage';

/** Distinct from the master key's `'master_key'` - a separate vault entry. */
const RECOVERY_PHRASE_KEY = 'recovery_phrase';

/**
 * Store the recovery phrase. Unlike load/clear this does NOT swallow errors:
 * the enable flow must learn if persisting failed, so it can warn the user
 * before they rely on unattended backups (an unstored phrase would later make
 * every run skip with `no-phrase`).
 */
export async function saveRecoveryPhrase(phrase: string): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  const storage = await getSecureStorage();
  await storage.setItem(RECOVERY_PHRASE_KEY, phrase);
}

/** The stored recovery phrase, or null when absent / unreadable / on web. */
export async function loadRecoveryPhrase(): Promise<string | null> {
  if (!__REBORN_NATIVE__) return null;
  try {
    const storage = await getSecureStorage();
    return await storage.getItem(RECOVERY_PHRASE_KEY);
  } catch {
    return null;
  }
}

/** Remove the stored phrase (disabling backups / logout). Best-effort. */
export async function clearRecoveryPhrase(): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  try {
    const storage = await getSecureStorage();
    await storage.removeItem(RECOVERY_PHRASE_KEY);
  } catch {
    // A failed delete must not block the flow.
  }
}
