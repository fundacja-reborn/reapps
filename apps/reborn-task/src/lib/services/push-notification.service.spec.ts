import { describe, it, expect } from 'vitest';
import {
	computeReminderFireAt,
	DEFAULT_NOTIFICATION_LEAD_MINUTES,
	DEFAULT_NOTIFICATION_ALL_DAY_TIME
} from './push-notification.service';

/**
 * `computeReminderFireAt` decides when a task reminder should fire.
 *
 * - has_time: leadMinutes before the due timestamp (a moment in time, TZ-agnostic).
 * - !has_time: due_date is UTC midnight; treat its UTC calendar day as the user's
 *   local calendar day and fire at allDayTime in local time.
 *
 * Tests run with TZ=Europe/Warsaw (set in CI / local dev). To stay robust across
 * environments we either (a) assert on TZ-agnostic invariants for has_time, or
 * (b) reconstruct the expected local timestamp the same way the production code
 * does, so the assertion holds in any timezone.
 */

describe('computeReminderFireAt', () => {
	const opts = {
		leadMinutes: DEFAULT_NOTIFICATION_LEAD_MINUTES,
		allDayTime: DEFAULT_NOTIFICATION_ALL_DAY_TIME
	};

	describe('has_time === true', () => {
		it('fires leadMinutes before due_date', () => {
			const due = '2026-05-10T14:30:00.000Z';
			const result = computeReminderFireAt({ due_date: due, has_time: true }, opts);
			expect(result).toBe(new Date(due).getTime() - 60 * 60 * 1000);
		});

		it('respects custom leadMinutes', () => {
			const due = '2026-05-10T14:30:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: true },
				{ leadMinutes: 1440, allDayTime: '09:00' }
			);
			expect(result).toBe(new Date(due).getTime() - 24 * 60 * 60 * 1000);
		});

		it('treats leadMinutes=0 as fire at due time', () => {
			const due = '2026-05-10T14:30:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: true },
				{ leadMinutes: 0, allDayTime: '09:00' }
			);
			expect(result).toBe(new Date(due).getTime());
		});
	});

	describe('has_time === false (date-only)', () => {
		it('fires at allDayTime in local time on the calendar day stored in due_date', () => {
			// due_date is UTC midnight — its UTC date components (Y/M/D) define the calendar day.
			const due = '2026-05-10T00:00:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: false },
				{ leadMinutes: 60, allDayTime: '09:00' }
			);

			// Expected: local 2026-05-10 09:00. Reconstruct the same way prod does
			// so the assertion is timezone-agnostic.
			const expected = new Date(2026, 4, 10, 9, 0, 0, 0).getTime();
			expect(result).toBe(expected);
		});

		it('respects a custom allDayTime', () => {
			const due = '2026-05-10T00:00:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: false },
				{ leadMinutes: 60, allDayTime: '18:30' }
			);
			const expected = new Date(2026, 4, 10, 18, 30, 0, 0).getTime();
			expect(result).toBe(expected);
		});

		it('does NOT subtract leadMinutes for date-only tasks', () => {
			const due = '2026-05-10T00:00:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: false },
				{ leadMinutes: 1440, allDayTime: '09:00' }
			);
			// Result is 09:00 local on 2026-05-10, regardless of leadMinutes.
			const expected = new Date(2026, 4, 10, 9, 0, 0, 0).getTime();
			expect(result).toBe(expected);
		});

		it('falls back to default allDayTime on malformed input', () => {
			const due = '2026-05-10T00:00:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: false },
				{ leadMinutes: 60, allDayTime: 'not-a-time' }
			);
			// Default is 09:00.
			const expected = new Date(2026, 4, 10, 9, 0, 0, 0).getTime();
			expect(result).toBe(expected);
		});

		it('uses UTC date components — does not shift calendar day across midnight TZ boundary', () => {
			// In TZ ahead of UTC (e.g. Warsaw +1/+2), `new Date('2026-05-10T00:00:00.000Z')`
			// would render as May 10 01:00–02:00 local. Using getDate() instead of
			// getUTCDate() would still return 10 here, so this test is defensive: ensure
			// we read UTC components — a regression that switched to local would still
			// land on the same day in this case but would break for users in negative
			// offsets (e.g. America/Los_Angeles where the same instant is May 9 17:00).
			const due = '2026-05-10T00:00:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: false },
				{ leadMinutes: 0, allDayTime: '09:00' }
			);
			const taskLocalDate = new Date(result!);
			expect(taskLocalDate.getDate()).toBe(10);
			expect(taskLocalDate.getMonth()).toBe(4); // May (0-indexed)
			expect(taskLocalDate.getFullYear()).toBe(2026);
			expect(taskLocalDate.getHours()).toBe(9);
			expect(taskLocalDate.getMinutes()).toBe(0);
		});
	});

	describe('invalid inputs', () => {
		it('returns null when due_date is missing', () => {
			expect(computeReminderFireAt({ due_date: null, has_time: false }, opts)).toBeNull();
		});

		it('returns null when due_date is unparseable', () => {
			expect(computeReminderFireAt({ due_date: 'not-a-date', has_time: true }, opts)).toBeNull();
		});
	});

	describe('regression: pre-fix behaviour', () => {
		// Before the fix, all tasks (including date-only) used `dueMs - 60min`.
		// For a date-only task in PL summer (UTC+2), midnight UTC = 02:00 local;
		// fireAt = 01:00 local — i.e. 1 AM in the night BEFORE the user expected.
		// After the fix, date-only tasks fire at 09:00 local (default).
		it('date-only task fires in the morning, not at 01:00 local', () => {
			const due = '2026-05-10T00:00:00.000Z';
			const result = computeReminderFireAt(
				{ due_date: due, has_time: false },
				{ leadMinutes: 60, allDayTime: '09:00' }
			);
			const fired = new Date(result!);
			expect(fired.getHours()).toBe(9); // not 0/1/2 AM
		});
	});
});

describe('default constants', () => {
	it('DEFAULT_NOTIFICATION_LEAD_MINUTES is 60', () => {
		expect(DEFAULT_NOTIFICATION_LEAD_MINUTES).toBe(60);
	});

	it('DEFAULT_NOTIFICATION_ALL_DAY_TIME is 09:00', () => {
		expect(DEFAULT_NOTIFICATION_ALL_DAY_TIME).toBe('09:00');
	});
});

