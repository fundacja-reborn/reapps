/**
 * Pure scheduling / rotation / filename logic for the automated ZK backup
 * feature (see reapps-docs `planning/auto-backup-zk.md`). Shared by both apps so
 * the cadence and retention behave identically; deliberately free of any store,
 * crypto, filesystem or platform dependency so it is trivially unit-testable.
 *
 * The orchestrator (per app) supplies the runtime inputs - the last successful
 * backup time and the newest `updated_at` across the local stores - and acts on
 * the decisions here (produce a backup, delete rotated-out files).
 */

/** The two apps that produce backups. Drives filename prefixes. */
export type RebornApp = 'reborn-notes' | 'reborn-task';

/** Grandfather-father-son retention: how many recent buckets to keep per unit. */
export interface RetentionPolicy {
  /** Keep the newest backup of each of the most-recent N days. */
  daily: number;
  /** Then keep the newest of each of the most-recent N 7-day windows. */
  weekly: number;
  /** Then keep the newest of each of the most-recent N calendar months. */
  monthly: number;
}

/** User-tunable auto-backup settings (persisted per device, never synced). */
export interface AutoBackupConfig {
  /** Master switch. Opt-in: defaults to off. */
  enabled: boolean;
  /** Minimum hours between automatic backups (the "daily" cadence). */
  intervalHours: number;
  /** Retention policy applied after each successful backup. */
  retention: RetentionPolicy;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 3 };

export const DEFAULT_AUTO_BACKUP_CONFIG: AutoBackupConfig = {
  enabled: false,
  intervalHours: 24,
  retention: DEFAULT_RETENTION
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Inputs for the "should we back up right now?" decision. */
export interface BackupDueInput {
  enabled: boolean;
  intervalHours: number;
  /** ISO timestamp of the last SUCCESSFUL backup, or null if never. */
  lastBackupAt: string | null;
  /** Current time as epoch milliseconds. */
  now: number;
  /**
   * ISO timestamp of the newest change across the local stores (max
   * `updated_at`), or null when there is no data. Used for skip-if-unchanged so
   * we don't write identical files day after day. Note: a pure hard-delete that
   * lowers the max `updated_at` is not seen as a change - acceptable, since a
   * backup exists to restore data, not to record its absence (soft-deletes /
   * trash bump `updated_at` and ARE captured).
   */
  lastDataChangeAt: string | null;
}

/**
 * Decide whether an automatic backup is due. True only when the feature is on,
 * there is data to back up, AND either nothing has been backed up yet or the
 * data changed since the last backup and the cadence interval has elapsed.
 */
export function isBackupDue(input: BackupDueInput): boolean {
  if (!input.enabled) return false;
  // Nothing to back up (no data, or all data hard-deleted).
  if (input.lastDataChangeAt === null) return false;
  // Have data, never backed up -> back up now.
  if (input.lastBackupAt === null) return true;

  const lastBackupMs = Date.parse(input.lastBackupAt);
  // A corrupt last-backup timestamp shouldn't wedge the feature; back up.
  if (Number.isNaN(lastBackupMs)) return true;

  const lastChangeMs = Date.parse(input.lastDataChangeAt);
  const dataChanged = Number.isNaN(lastChangeMs) || lastChangeMs > lastBackupMs;
  if (!dataChanged) return false; // skip-if-unchanged

  return input.now - lastBackupMs >= input.intervalHours * MS_PER_HOUR;
}

/** A backup file as seen on disk, with the time it was taken. */
export interface BackupFile {
  /** Filename, e.g. `reborn-notes-backup-20260627-054512.json`. */
  name: string;
  /** ISO timestamp the backup was taken (from the filename or file mtime). */
  at: string;
}

/** Numeric bucket index so the most-recent buckets sort without lexical traps. */
function bucketIndex(ms: number, unit: 'day' | 'week' | 'month'): number {
  if (unit === 'day') return Math.floor(ms / MS_PER_DAY);
  if (unit === 'week') return Math.floor(ms / MS_PER_WEEK);
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Apply a GFS retention policy to a list of backup files: keep the newest file
 * in each of the most-recent `daily` days, `weekly` 7-day windows and `monthly`
 * months (the union), and mark the rest for removal.
 *
 * Files with an unparseable `at` are left untouched (never removed) - we only
 * rotate files we can reason about. The orchestrator should pass only its own
 * backup files (matched via {@link isBackupFilename}).
 */
export function planRotation(
  files: BackupFile[],
  policy: RetentionPolicy
): { keep: BackupFile[]; remove: BackupFile[] } {
  const valid = files.filter((f) => !Number.isNaN(Date.parse(f.at)));
  const keep = new Set<BackupFile>();

  const units: Array<['day' | 'week' | 'month', number]> = [
    ['day', policy.daily],
    ['week', policy.weekly],
    ['month', policy.monthly]
  ];

  for (const [unit, count] of units) {
    if (count <= 0) continue;
    // Newest file per bucket.
    const newestPerBucket = new Map<number, BackupFile>();
    for (const f of valid) {
      const idx = bucketIndex(Date.parse(f.at), unit);
      const current = newestPerBucket.get(idx);
      if (!current || Date.parse(f.at) > Date.parse(current.at)) {
        newestPerBucket.set(idx, f);
      }
    }
    // Keep the newest file of each of the most-recent `count` buckets.
    const recentBuckets = [...newestPerBucket.keys()].sort((a, b) => b - a).slice(0, count);
    for (const idx of recentBuckets) keep.add(newestPerBucket.get(idx)!);
  }

  return {
    keep: valid.filter((f) => keep.has(f)),
    remove: valid.filter((f) => !keep.has(f))
  };
}

/** Two-digit zero-pad. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Build a content-free backup filename: app prefix + UTC timestamp only. Never
 * includes any user content (titles etc.) - the filename is visible metadata.
 *
 * @returns e.g. `reborn-notes-backup-20260627-054512.json`
 */
export function backupFilename(app: RebornApp, at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const stamp =
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
  return `${app}-backup-${stamp}.json`;
}

/** Matches a filename produced by {@link backupFilename} for the given app. */
export function isBackupFilename(app: RebornApp, name: string): boolean {
  return new RegExp(`^${app}-backup-\\d{8}-\\d{6}\\.json$`).test(name);
}

/**
 * Recover the ISO timestamp encoded in a backup filename, or null if the name
 * is not one of ours. Inverse of {@link backupFilename}.
 */
export function parseBackupTimestamp(app: RebornApp, name: string): string | null {
  if (!isBackupFilename(app, name)) return null;
  const m = name.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}
