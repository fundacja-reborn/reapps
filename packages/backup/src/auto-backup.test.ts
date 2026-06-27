import { describe, it, expect } from 'vitest';
import {
  isBackupDue,
  planRotation,
  backupFilename,
  isBackupFilename,
  parseBackupTimestamp,
  DEFAULT_AUTO_BACKUP_CONFIG,
  type BackupFile,
  type RetentionPolicy
} from './auto-backup';

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('isBackupDue', () => {
  const base = {
    enabled: true,
    intervalHours: 24,
    lastBackupAt: '2026-06-26T00:00:00.000Z',
    now: Date.parse('2026-06-27T00:00:00.000Z'),
    lastDataChangeAt: '2026-06-26T12:00:00.000Z'
  };

  it('is false when disabled', () => {
    expect(isBackupDue({ ...base, enabled: false })).toBe(false);
  });

  it('is false when there is no data to back up', () => {
    expect(isBackupDue({ ...base, lastDataChangeAt: null })).toBe(false);
  });

  it('is true on first run when data exists and nothing was backed up yet', () => {
    expect(isBackupDue({ ...base, lastBackupAt: null })).toBe(true);
  });

  it('is false when nothing changed since the last backup (skip-if-unchanged)', () => {
    expect(
      isBackupDue({
        ...base,
        lastBackupAt: '2026-06-26T12:00:00.000Z',
        lastDataChangeAt: '2026-06-26T12:00:00.000Z'
      })
    ).toBe(false);
  });

  it('is false when data changed but the interval has not elapsed', () => {
    expect(
      isBackupDue({
        ...base,
        lastBackupAt: '2026-06-26T23:00:00.000Z',
        lastDataChangeAt: '2026-06-26T23:30:00.000Z',
        now: Date.parse('2026-06-27T00:00:00.000Z') // only 1h later
      })
    ).toBe(false);
  });

  it('is true when data changed and the interval has elapsed', () => {
    expect(
      isBackupDue({
        ...base,
        lastBackupAt: '2026-06-26T00:00:00.000Z',
        lastDataChangeAt: '2026-06-26T18:00:00.000Z',
        now: Date.parse('2026-06-26T00:00:00.000Z') + 24 * HOUR + 1
      })
    ).toBe(true);
  });

  it('backs up defensively when the last-backup timestamp is corrupt', () => {
    expect(isBackupDue({ ...base, lastBackupAt: 'not-a-date' })).toBe(true);
  });

  it('default config is opt-in (disabled) with a 24h cadence', () => {
    expect(DEFAULT_AUTO_BACKUP_CONFIG.enabled).toBe(false);
    expect(DEFAULT_AUTO_BACKUP_CONFIG.intervalHours).toBe(24);
  });
});

describe('planRotation', () => {
  const f = (name: string, at: string): BackupFile => ({ name, at });

  it('returns nothing for an empty list', () => {
    expect(planRotation([], { daily: 7, weekly: 4, monthly: 3 })).toEqual({ keep: [], remove: [] });
  });

  it('keeps everything when there are fewer files than the policy allows', () => {
    const files = [f('a', '2026-06-27T10:00:00.000Z'), f('b', '2026-06-20T10:00:00.000Z')];
    const { keep, remove } = planRotation(files, { daily: 7, weekly: 4, monthly: 3 });
    expect(keep).toHaveLength(2);
    expect(remove).toHaveLength(0);
  });

  it('daily: keeps the newest file of each of the most-recent N days', () => {
    const files = [
      f('d27-late', '2026-06-27T10:00:00.000Z'),
      f('d27-early', '2026-06-27T08:00:00.000Z'),
      f('d26-late', '2026-06-26T10:00:00.000Z'),
      f('d26-early', '2026-06-26T08:00:00.000Z'),
      f('d25', '2026-06-25T10:00:00.000Z')
    ];
    const { keep, remove } = planRotation(files, { daily: 2, weekly: 0, monthly: 0 });
    expect(keep.map((k) => k.name).sort()).toEqual(['d26-late', 'd27-late']);
    expect(remove.map((r) => r.name).sort()).toEqual(['d25', 'd26-early', 'd27-early']);
  });

  it('monthly: keeps the newest file of each of the most-recent N months', () => {
    const files = [
      f('jun-late', '2026-06-27T10:00:00.000Z'),
      f('jun-early', '2026-06-01T10:00:00.000Z'),
      f('may', '2026-05-15T10:00:00.000Z'),
      f('apr', '2026-04-10T10:00:00.000Z')
    ];
    const { keep, remove } = planRotation(files, { daily: 0, weekly: 0, monthly: 2 });
    expect(keep.map((k) => k.name).sort()).toEqual(['jun-late', 'may']);
    expect(remove.map((r) => r.name).sort()).toEqual(['apr', 'jun-early']);
  });

  it('always keeps the single newest backup (daily >= 1)', () => {
    const files = [
      f('old', '2026-01-01T00:00:00.000Z'),
      f('newest', '2026-06-27T10:00:00.000Z'),
      f('mid', '2026-03-15T00:00:00.000Z')
    ];
    const { keep } = planRotation(files, { daily: 1, weekly: 0, monthly: 0 });
    expect(keep.map((k) => k.name)).toEqual(['newest']);
  });

  it('keep and remove partition the input with no overlap', () => {
    const files = Array.from({ length: 20 }, (_, i) =>
      f(`b${i}`, new Date(Date.parse('2026-06-27T00:00:00.000Z') - i * 9 * DAY).toISOString())
    );
    const policy: RetentionPolicy = { daily: 3, weekly: 3, monthly: 3 };
    const { keep, remove } = planRotation(files, policy);
    const names = new Set([...keep, ...remove].map((x) => x.name));
    expect(names.size).toBe(files.length); // every file accounted for exactly once
    expect(keep.length + remove.length).toBe(files.length);
    expect(keep.length).toBeLessThanOrEqual(policy.daily + policy.weekly + policy.monthly);
    expect(keep.length).toBeGreaterThan(0);
  });

  it('leaves files with unparseable timestamps untouched (never removed)', () => {
    const files = [f('good', '2026-06-27T10:00:00.000Z'), f('weird', 'not-a-date')];
    const { keep, remove } = planRotation(files, { daily: 1, weekly: 0, monthly: 0 });
    expect(keep.map((k) => k.name)).toEqual(['good']);
    expect(remove).toHaveLength(0);
  });
});

describe('backup filenames', () => {
  it('builds a content-free UTC-stamped filename', () => {
    expect(backupFilename('reborn-notes', '2026-06-27T05:45:12.000Z')).toBe(
      'reborn-notes-backup-20260627-054512.json'
    );
    expect(backupFilename('reborn-task', new Date('2026-12-01T23:09:00.000Z'))).toBe(
      'reborn-task-backup-20261201-230900.json'
    );
  });

  it('round-trips through parseBackupTimestamp', () => {
    const iso = '2026-06-27T05:45:12.000Z';
    const name = backupFilename('reborn-notes', iso);
    expect(parseBackupTimestamp('reborn-notes', name)).toBe(iso);
  });

  it('recognizes only its own app’s files', () => {
    const name = backupFilename('reborn-notes', '2026-06-27T05:45:12.000Z');
    expect(isBackupFilename('reborn-notes', name)).toBe(true);
    expect(isBackupFilename('reborn-task', name)).toBe(false);
    expect(isBackupFilename('reborn-notes', 'random.json')).toBe(false);
    expect(isBackupFilename('reborn-notes', 'reborn-notes-backup-portable-2026-06-27.json')).toBe(
      false
    );
    expect(parseBackupTimestamp('reborn-notes', 'random.json')).toBeNull();
  });
});
