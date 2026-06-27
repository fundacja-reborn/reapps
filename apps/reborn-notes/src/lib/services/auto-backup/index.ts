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
import { buildEncryptedBackup } from '$lib/services/export-import.service';
import { loadAutoBackupConfig, loadAutoBackupState, saveAutoBackupState } from './prefs';
import { getLastDataChangeAt } from './watermark';
import { verifyBackup } from './verify';

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

export {
  loadAutoBackupConfig,
  saveAutoBackupConfig,
  loadAutoBackupState,
  DEFAULT_NOTES_AUTO_BACKUP_CONFIG,
  type NotesAutoBackupConfig
} from './prefs';
