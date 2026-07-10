/**
 * Tests for the pure overdue-reminder planner. The native executor
 * (syncBackupReminders) is dead code under vitest (`__REBORN_NATIVE__` false),
 * so the decision logic lives in `planBackupReminders` and is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { BACKUP_REMINDER_IDS, planBackupReminders } from './reminder';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe('planBackupReminders', () => {
  it('plans a nudge 2h past the cadence point and a follow-up ~a week later', () => {
    const lastBackupAt = NOW - 3 * HOUR;
    const plan = planBackupReminders({
      enabled: true,
      configured: true,
      lastBackupAt,
      intervalHours: 24,
      now: NOW
    });
    expect(plan).toEqual([
      { id: BACKUP_REMINDER_IDS[0], at: lastBackupAt + 26 * HOUR },
      { id: BACKUP_REMINDER_IDS[1], at: lastBackupAt + 26 * HOUR + 6 * DAY }
    ]);
  });

  it('clamps to a 1h minimum lead when the backup is already overdue', () => {
    const plan = planBackupReminders({
      enabled: true,
      configured: true,
      lastBackupAt: NOW - 10 * DAY,
      intervalHours: 24,
      now: NOW
    });
    expect(plan[0].at).toBe(NOW + HOUR);
    expect(plan[1].at).toBe(NOW + HOUR + 6 * DAY);
  });

  it('measures from now when no backup has run yet', () => {
    const plan = planBackupReminders({
      enabled: true,
      configured: true,
      lastBackupAt: null,
      intervalHours: 24,
      now: NOW
    });
    expect(plan[0].at).toBe(NOW + 26 * HOUR);
  });

  it('plans nothing when disabled or not configured', () => {
    const base = { lastBackupAt: NOW, intervalHours: 24, now: NOW };
    expect(planBackupReminders({ enabled: false, configured: true, ...base })).toEqual([]);
    expect(planBackupReminders({ enabled: true, configured: false, ...base })).toEqual([]);
  });
});
