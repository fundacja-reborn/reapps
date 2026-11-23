/**
 * What the notes view says about the automatic backup: nothing while it
 * works, and the reason plus a way to fix it when it does not (the notice
 * above the sync status, `BackupAttentionNotice.svelte`; guideline 71).
 *
 * The notice follows the outcome of the latest run, not a prediction from the
 * saved state: every app open and resume runs the backup, so a notice derived
 * from "overdue" alone would flash on each resume and vanish a second later
 * when the run succeeds. An overdue backup always has a cause the run reports
 * (a failed write, a missing recovery phrase), and that cause is what the user
 * can act on. Until the first run of a launch the notice stays hidden.
 *
 * Pure decisions here (tested), plus the in-memory store the footer reads.
 * Never persisted: the saved state (`prefs.ts`) is the source of truth, this
 * is only its reading for the UI.
 */

import { writable, type Readable } from 'svelte/store';
import type { AutoBackupOutcome, AutoBackupState } from '@reborn/backup';

/** Why a backup failed, in the terms the user is told. */
export type BackupProblem = 'no-access' | 'folder-missing' | 'failed';

export type BackupAttention =
  /** The last attempt failed; `detail` is the raw reason (shown for `failed`). */
  | { kind: 'failed'; problem: BackupProblem; detail: string }
  /** Backups are on, but this device has no recovery phrase to encrypt them. */
  | { kind: 'no-phrase' };

/**
 * The problem behind a failure code of the folder bridges (the same codes on
 * iOS, Android and desktop; `FOLDER_NOT_FOUND` also stands for the
 * `NotFoundError` DOMException, see `backupErrorCode`).
 */
export function backupProblem(code: string | null | undefined): BackupProblem {
  switch (code) {
    case 'ACCESS_DENIED':
      return 'no-access';
    case 'FOLDER_NOT_FOUND':
      return 'folder-missing';
    default:
      return 'failed';
  }
}

/** The notice the saved state alone calls for (no run outcome at hand). */
export function attentionFromState(
  enabled: boolean,
  state: AutoBackupState
): BackupAttention | null {
  if (!enabled || !state.lastError) return null;
  return {
    kind: 'failed',
    problem: backupProblem(state.lastErrorCode),
    detail: state.lastError
  };
}

/**
 * The notice after a run, from its outcome and the state it saved.
 * `undefined` = the run could not judge (crypto locked): keep what is shown.
 */
export function attentionAfterRun(
  outcome: AutoBackupOutcome,
  enabled: boolean,
  state: AutoBackupState
): BackupAttention | null | undefined {
  if (!enabled) return null;
  switch (outcome.status) {
    case 'backed-up':
      return null;
    case 'error':
      return { kind: 'failed', problem: backupProblem(outcome.code), detail: outcome.error };
    case 'skipped':
      switch (outcome.reason) {
        case 'no-phrase':
          return { kind: 'no-phrase' };
        case 'locked':
          return undefined;
        case 'not-due':
          // A forced run that failed within a day of a good backup leaves the
          // run not due, but the failure stands until a backup succeeds.
          return attentionFromState(enabled, state);
        default:
          // disabled / no-destination / no-data: nothing to back up here.
          return null;
      }
  }
}

/**
 * What the user reads about a failure: an explanation for the problems we
 * recognise, the raw reason otherwise (a disk error, a failed self-test).
 */
export function backupProblemText(
  problem: BackupProblem,
  detail: string,
  translate: (id: string) => string
): string {
  switch (problem) {
    case 'no-access':
      return translate('backup_attention.no_access');
    case 'folder-missing':
      return translate('backup_attention.folder_missing');
    case 'failed':
      return detail;
  }
}

const attention = writable<BackupAttention | null>(null);
const running = writable(false);

/** The notice to show, or null. */
export const backupAttention: Readable<BackupAttention | null> = {
  subscribe: attention.subscribe
};

/** A "back up now" (notice, desktop menu, Settings) is in progress. */
export const backupRunning: Readable<boolean> = { subscribe: running.subscribe };

/** Show `next`; `undefined` keeps the current notice. */
export function showBackupAttention(next: BackupAttention | null | undefined): void {
  if (next !== undefined) attention.set(next);
}

/** Hide the notice (logout, local wipe). */
export function clearBackupAttention(): void {
  attention.set(null);
}

export function setBackupRunning(value: boolean): void {
  running.set(value);
}
