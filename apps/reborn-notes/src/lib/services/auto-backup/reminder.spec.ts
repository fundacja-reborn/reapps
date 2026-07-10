/**
 * Tests for the pure overdue-reminder planner. The native executor
 * (syncBackupReminders) is dead code under vitest (`__REBORN_NATIVE__` false),
 * so the decision logic lives in `planBackupReminders` and is pinned here.
 *
 * Invariant under test: a reminder exists ONLY while something is actually
 * unbacked. `lastBackupAt` freezes when the data is unchanged (the runner's
 * skip-if-unchanged gate), so planning from it alone would nag a read-only
 * user one hour after every single open.
 */
import { describe, expect, it } from 'vitest';
import { BACKUP_REMINDER_IDS, planBackupReminders } from './reminder';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

const base = { enabled: true, configured: true, intervalHours: 24, now: NOW };

describe('planBackupReminders', () => {
  it('plans a nudge 2h past the cadence point and a follow-up ~a week later', () => {
    const lastBackupAt = NOW - 3 * HOUR;
    const plan = planBackupReminders({
      ...base,
      lastBackupAt,
      lastDataChangeAt: NOW - HOUR
    });
    expect(plan).toEqual([
      { id: BACKUP_REMINDER_IDS[0], at: lastBackupAt + 26 * HOUR },
      { id: BACKUP_REMINDER_IDS[1], at: lastBackupAt + 26 * HOUR + 6 * DAY }
    ]);
  });

  it('clamps to a 1h minimum lead when the backup is already overdue', () => {
    const plan = planBackupReminders({
      ...base,
      lastBackupAt: NOW - 10 * DAY,
      lastDataChangeAt: NOW - 5 * DAY
    });
    expect(plan[0].at).toBe(NOW + HOUR);
    expect(plan[1].at).toBe(NOW + HOUR + 6 * DAY);
  });

  it('measures from now when no backup has run yet', () => {
    const plan = planBackupReminders({
      ...base,
      lastBackupAt: null,
      lastDataChangeAt: NOW - HOUR
    });
    expect(plan[0].at).toBe(NOW + 26 * HOUR);
  });

  it('plans nothing while the data is fully backed up (read-only usage must not nag)', () => {
    // lastBackupAt frozen for days because nothing changed - the exact state
    // a read-only user is in on every open.
    expect(
      planBackupReminders({
        ...base,
        lastBackupAt: NOW - 10 * DAY,
        lastDataChangeAt: NOW - 12 * DAY
      })
    ).toEqual([]);
    // Equal timestamps count as covered too.
    expect(
      planBackupReminders({ ...base, lastBackupAt: NOW - DAY, lastDataChangeAt: NOW - DAY })
    ).toEqual([]);
  });

  it('plans nothing when there is no data at all', () => {
    expect(planBackupReminders({ ...base, lastBackupAt: null, lastDataChangeAt: null })).toEqual(
      []
    );
  });

  it('plans nothing when disabled or not configured', () => {
    const args = { lastBackupAt: NOW - 2 * DAY, lastDataChangeAt: NOW, intervalHours: 24, now: NOW };
    expect(planBackupReminders({ enabled: false, configured: true, ...args })).toEqual([]);
    expect(planBackupReminders({ enabled: true, configured: false, ...args })).toEqual([]);
  });
});
