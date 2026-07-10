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
import { autoBackupScopeId } from './prefs';

/**
 * Distinct from the master key's `'master_key'` - a separate vault entry,
 * keyed per user (same scope id as the localStorage prefs): on a shared
 * device the next account must never read - or unknowingly back up with -
 * the previous owner's phrase.
 */
const RECOVERY_PHRASE_KEY_PREFIX = 'recovery_phrase';

/** Pre-scoping global key (early native builds) - only ever deleted now. */
const LEGACY_RECOVERY_PHRASE_KEY = 'recovery_phrase';

const phraseKey = (scopeId: string): string => `${RECOVERY_PHRASE_KEY_PREFIX}_${scopeId}`;

/**
 * Store the recovery phrase. Unlike load/clear this does NOT swallow errors:
 * the enable flow must learn if persisting failed, so it can warn the user
 * before they rely on unattended backups (an unstored phrase would later make
 * every run skip with `no-phrase`).
 */
export async function saveRecoveryPhrase(phrase: string): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  const scopeId = autoBackupScopeId();
  if (!scopeId) throw new Error('No session to scope the recovery phrase to');
  const storage = await getSecureStorage();
  await storage.setItem(phraseKey(scopeId), phrase);
}

/** The current user's stored recovery phrase, or null when absent / unreadable / on web. */
export async function loadRecoveryPhrase(): Promise<string | null> {
  if (!__REBORN_NATIVE__) return null;
  try {
    const scopeId = autoBackupScopeId();
    if (!scopeId) return null;
    const storage = await getSecureStorage();
    return await storage.getItem(phraseKey(scopeId));
  } catch {
    return null;
  }
}

/**
 * Re-key the stored phrase from one scope id to another (local→account
 * upgrade - see migrateAutoBackupPrefsScope for why). The target entry is
 * never overwritten if it somehow exists; the source entry is removed either
 * way. Best-effort: the phrase is also recoverable from the synced wrapped
 * copy (phrase-sync), so a failed vault migration self-heals on reconcile.
 */
export async function migrateRecoveryPhraseScope(
  fromScopeId: string,
  toScopeId: string
): Promise<void> {
  if (!__REBORN_NATIVE__ || fromScopeId === toScopeId) return;
  try {
    const storage = await getSecureStorage();
    const phrase = await storage.getItem(phraseKey(fromScopeId));
    if (phrase !== null && (await storage.getItem(phraseKey(toScopeId))) === null) {
      await storage.setItem(phraseKey(toScopeId), phrase);
    }
    await storage.removeItem(phraseKey(fromScopeId));
  } catch {
    // Best-effort - reconcile republishes/hydrates from the synced copy.
  }
}

/**
 * Remove the current user's stored phrase (disabling backups / logout), plus
 * the legacy unscoped entry from builds before per-user scoping. Best-effort.
 */
export async function clearRecoveryPhrase(): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  try {
    const storage = await getSecureStorage();
    const scopeId = autoBackupScopeId();
    if (scopeId) await storage.removeItem(phraseKey(scopeId));
    await storage.removeItem(LEGACY_RECOVERY_PHRASE_KEY);
  } catch {
    // A failed delete must not block the flow.
  }
}
