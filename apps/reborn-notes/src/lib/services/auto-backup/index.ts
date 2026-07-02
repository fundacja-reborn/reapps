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
 * runtime state (localStorage) and the recovery phrase (OS vault). Called on
 * logout and on the local-only wipe, BEFORE the session keys are removed -
 * the entries are keyed by the session's user id, so this is the last moment
 * they are addressable. Best-effort by design: a failed wipe is logged but
 * must never block the logout flow (per-user keying already prevents another
 * account from reading what might remain).
 */
export async function clearAutoBackupState(): Promise<void> {
  try {
    clearAutoBackupPrefs();
    if (!__REBORN_NATIVE__) return;
    // Lazy import keeps the native secure-storage bridge out of the web bundle.
    const { clearRecoveryPhrase } = await import('./recovery-phrase-vault');
    await clearRecoveryPhrase();
  } catch (err) {
    logger.error('Failed to clear auto-backup state:', err);
  }
}

export {
  loadAutoBackupConfig,
  saveAutoBackupConfig,
  loadAutoBackupState,
  DEFAULT_NOTES_AUTO_BACKUP_CONFIG,
  type NotesAutoBackupConfig
} from './prefs';
