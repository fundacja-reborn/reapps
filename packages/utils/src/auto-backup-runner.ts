/**
 * The automated-backup orchestrator: one dependency-injected run of the
 * "back up if due" cycle, shared by both apps. Deliberately free of crypto,
 * store, filesystem and platform imports (utils must not depend on crypto -
 * that would cycle); every side effect is injected, which also makes the whole
 * decision/IO flow unit-testable with fakes.
 *
 * Each app provides the adapters: the destination (native folder via the
 * filesystem bridge), the recovery phrase (from the OS vault), the
 * data-change watermark and the encrypted-bytes builder (see
 * `planning/auto-backup-zk.md`).
 */

import {
  isBackupDue,
  planRotation,
  backupFilename,
  type AutoBackupConfig,
  type BackupFile,
  type RebornApp
} from './auto-backup';

/** A place automated backups are written to (a user-chosen folder). */
export interface BackupDestination {
  /** Whether a writable target is configured (folder picked, permission live). */
  isConfigured(): Promise<boolean>;
  /** Write the backup bytes under `filename`. */
  write(filename: string, blob: Blob): Promise<void>;
  /** Read a backup file's text back (for the post-write self-test / restore). */
  read(filename: string): Promise<string>;
  /** List existing backup files (name + taken-at) for rotation. */
  list(): Promise<BackupFile[]>;
  /** Delete a backup file by name (rotation). */
  remove(filename: string): Promise<void>;
}

/** Persisted runtime state of the feature (per device, never synced). */
export interface AutoBackupState {
  /** ISO timestamp of the last SUCCESSFUL backup, or null if never. */
  lastBackupAt: string | null;
  /** Human-readable reason the last attempt failed, or null if it succeeded. */
  lastError: string | null;
}

export interface RunAutoBackupDeps {
  app: RebornApp;
  config: AutoBackupConfig;
  state: AutoBackupState;
  /** Current time as epoch milliseconds (injected for determinism). */
  now: number;
  destination: BackupDestination;
  /** Newest `updated_at` across the local stores, or null when empty. */
  getLastDataChangeAt: () => Promise<string | null>;
  /** The recovery phrase from the OS vault, or null when unavailable. */
  getRecoveryPhrase: () => Promise<string | null>;
  /** Produce the encrypted backup bytes for the given phrase. */
  buildBackup: (phrase: string) => Promise<Blob>;
  /** Persist updated state (lastBackupAt / lastError). */
  saveState: (next: AutoBackupState) => Promise<void>;
  /**
   * Optional post-write integrity self-test: given the bytes read back from
   * disk and the phrase, throw if they don't decrypt. Keeps utils crypto-free -
   * the app supplies the decrypt round-trip.
   */
  verifyBackup?: (writtenContent: string, phrase: string) => Promise<void>;
}

export type AutoBackupSkipReason =
  | 'disabled'
  | 'no-destination'
  | 'not-due'
  | 'no-data'
  | 'no-phrase';

export type AutoBackupOutcome =
  | { status: 'skipped'; reason: AutoBackupSkipReason }
  | { status: 'backed-up'; filename: string; removed: string[] }
  | { status: 'error'; error: string };

/**
 * Run one automated-backup cycle. Returns a structured outcome (never throws):
 * gate on enabled/destination/cadence, produce + write + self-test the
 * encrypted bytes, record state, then rotate old files. A rotation failure does
 * not fail the backup itself (the new file is already safely written).
 */
export async function runAutoBackup(deps: RunAutoBackupDeps): Promise<AutoBackupOutcome> {
  const { config, state, now } = deps;

  if (!config.enabled) return { status: 'skipped', reason: 'disabled' };
  if (!(await deps.destination.isConfigured())) {
    return { status: 'skipped', reason: 'no-destination' };
  }

  const lastDataChangeAt = await deps.getLastDataChangeAt();
  const due = isBackupDue({
    enabled: config.enabled,
    intervalHours: config.intervalHours,
    lastBackupAt: state.lastBackupAt,
    now,
    lastDataChangeAt
  });
  if (!due) {
    return { status: 'skipped', reason: lastDataChangeAt === null ? 'no-data' : 'not-due' };
  }

  const phrase = await deps.getRecoveryPhrase();
  if (!phrase) return { status: 'skipped', reason: 'no-phrase' };

  const filename = backupFilename(deps.app, new Date(now));
  try {
    const blob = await deps.buildBackup(phrase);
    await deps.destination.write(filename, blob);

    if (deps.verifyBackup) {
      try {
        const written = await deps.destination.read(filename);
        await deps.verifyBackup(written, phrase);
      } catch (verifyError) {
        // A file that won't decrypt is worse than no file - remove it so a
        // half-written backup can't masquerade as a good one, then report.
        await deps.destination.remove(filename).catch(() => undefined);
        throw verifyError;
      }
    }

    await deps.saveState({ lastBackupAt: new Date(now).toISOString(), lastError: null });

    const removed = await rotate(deps);
    return { status: 'backed-up', filename, removed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Keep the previous lastBackupAt so the run stays due next time; record why.
    await deps.saveState({ lastBackupAt: state.lastBackupAt, lastError: message });
    return { status: 'error', error: message };
  }
}

/** Apply retention; never throws (rotation must not fail a good backup). */
async function rotate(deps: RunAutoBackupDeps): Promise<string[]> {
  try {
    const existing = await deps.destination.list();
    const { remove } = planRotation(existing, deps.config.retention);
    const removed: string[] = [];
    for (const file of remove) {
      await deps.destination.remove(file.name);
      removed.push(file.name);
    }
    return removed;
  } catch {
    return [];
  }
}
