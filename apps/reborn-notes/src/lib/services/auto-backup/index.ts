/**
 * Notes-side wiring of the shared automated-backup orchestrator
 * (`runAutoBackup` in `@reborn/backup`). This module is the only place that
 * knows how the abstract dependencies map onto reborn-notes: the encrypted
 * backup builder, the local stores, the OS vault and the native folder.
 *
 * Trigger this on app open / resume once crypto is unlocked (see the root
 * layout). It is safe to call eagerly: it gates on platform, unlock state,
 * the enabled flag, a configured folder and the cadence, returning a structured
 * outcome and never throwing.
 */

import { runAutoBackup, type AutoBackupOutcome } from '@reborn/backup';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { buildEncryptedBackup } from '$lib/services/export-import.service';
import {
  clearAutoBackupPrefs,
  loadAutoBackupConfig,
  loadAutoBackupState,
  saveAutoBackupState
} from './prefs';
import { getLastDataChangeAt } from './watermark';
import { verifyBackup } from './verify';

const logger = createLogger('Notes-AutoBackup');

/**
 * Run one "back up if due" cycle for reborn-notes.
 *
 * @param opts.force bypass the cadence gate (a manual "back up now")
 * @param opts.now epoch ms (injectable for tests; defaults to wall clock)
 */
export async function runNotesAutoBackupIfDue(
  opts: { force?: boolean; now?: number } = {}
): Promise<AutoBackupOutcome> {
  // Real silent auto-backup is native-only: web has no persistent unattended
  // write target nor a secure vault for the phrase. Web export stays manual.
  if (!__REBORN_NATIVE__) return { status: 'skipped', reason: 'no-destination' };

  // The backup decrypts account data to re-wrap it portably; needs the key.
  if (!cryptoManager.isInitialized()) return { status: 'skipped', reason: 'locked' };

  // Sync the vault with the account-scoped wrapped phrase BEFORE reading any
  // config: this hydrates a fresh/wiped device after login (the settings pull
  // at unlock runs earlier in the same runSync), picks up a rotation made on
  // another device, and publishes the phrase of installs that predate account
  // scoping. Runs even when auto-backup is disabled here, so the settings
  // page later finds the phrase ready. Never throws.
  try {
    const { reconcileRecoveryPhrase } = await import('./phrase-sync');
    await reconcileRecoveryPhrase();
  } catch (err) {
    logger.warn('Recovery phrase reconcile before backup failed:', err);
  }

  const config = loadAutoBackupConfig();
  if (!config.enabled) return { status: 'skipped', reason: 'disabled' };

  // Import the native-only adapters lazily so the web bundle never pulls the
  // secure-storage / FolderFs bridges (they throw on web by construction).
  const { createNativeFolderDestination } = await import('./folder-destination');
  const { loadRecoveryPhrase } = await import('./recovery-phrase-vault');

  return runAutoBackup({
    app: 'reborn-notes',
    config,
    state: loadAutoBackupState(),
    now: opts.now ?? Date.now(),
    force: opts.force,
    destination: createNativeFolderDestination(config.folderBookmark),
    getLastDataChangeAt,
    getRecoveryPhrase: loadRecoveryPhrase,
    buildBackup: async (phrase) => (await buildEncryptedBackup(phrase)).blob,
    saveState: async (next) => saveAutoBackupState(next),
    verifyBackup
  });
}

/**
 * Wipe the CURRENT user's auto-backup footprint on this device: config +
 * runtime state (localStorage), the OS-level folder grant (Android SAF) and
 * the recovery phrase (OS vault). Called on logout and on the local-only
 * wipe, BEFORE the session keys are removed - the entries are keyed by the
 * session's user id, so this is the last moment they are addressable.
 * Best-effort by design: a failed wipe is logged but must never block the
 * logout flow (per-user keying already prevents another account from reading
 * what might remain).
 */
export async function clearAutoBackupState(): Promise<void> {
  try {
    // Capture the bookmark BEFORE the prefs wipe: releasing the persisted SAF
    // grant needs the tree Uri, and once the config entry is gone the Uri is
    // unrecoverable - the orphaned grant would dangle in the OS until uninstall.
    const folderBookmark = __REBORN_NATIVE__
      ? loadAutoBackupConfig().folderBookmark
      : undefined;
    clearAutoBackupPrefs();
    if (!__REBORN_NATIVE__) return;
    if (folderBookmark) {
      try {
        // Lazy import keeps the FolderFs bridge out of the web bundle. The
        // backup folder was picked with { write: true }, so release the same
        // READ|WRITE modes. iOS resolves this as a no-op (a plain bookmark
        // holds no OS-level grant).
        const { getFolderFs } = await import('$lib/utils/native-folder-fs');
        await getFolderFs().releaseDirectory({ bookmark: folderBookmark, write: true });
      } catch (err) {
        // Own catch: a failed release must not block the vault wipe below.
        logger.error('Failed to release auto-backup folder grant:', err);
      }
    }
    // Lazy import keeps the native secure-storage bridge out of the web bundle.
    const { clearRecoveryPhrase } = await import('./recovery-phrase-vault');
    await clearRecoveryPhrase();
  } catch (err) {
    logger.error('Failed to clear auto-backup state:', err);
  }
}

/**
 * Carry the auto-backup setup across the local→account upgrade: the upgrade
 * swaps `autoBackupScopeId()` from the local pseudo id to the account id, so
 * without this the config/state (localStorage) and phrase (OS vault) written
 * under the local id would be orphaned and the upgraded account would start
 * from a disabled, phraseless default - forcing a full re-setup on the very
 * device that already has a valid folder grant and phrase. Same device, same
 * human: carrying it over is safe. Call AFTER the account credentials are in
 * localStorage (so pushes see the account) and BEFORE any backup run.
 * Best-effort: a failure only costs the user a re-setup, like before.
 */
export async function migrateAutoBackupScope(
  fromScopeId: string | null,
  toScopeId: string
): Promise<void> {
  if (!fromScopeId || fromScopeId === toScopeId) return;
  try {
    const { migrateAutoBackupPrefsScope } = await import('./prefs');
    migrateAutoBackupPrefsScope(fromScopeId, toScopeId);
    if (__REBORN_NATIVE__) {
      const { migrateRecoveryPhraseScope } = await import('./recovery-phrase-vault');
      await migrateRecoveryPhraseScope(fromScopeId, toScopeId);
    }
  } catch (err) {
    logger.error('Failed to migrate auto-backup scope on account upgrade:', err);
  }
}

export {
  loadAutoBackupConfig,
  saveAutoBackupConfig,
  loadAutoBackupState,
  DEFAULT_NOTES_AUTO_BACKUP_CONFIG,
  type NotesAutoBackupConfig
} from './prefs';
