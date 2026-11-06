import { describe, it, expect } from 'vitest';
import { rrulestr } from 'rrule';
import { RRULE_WEEKDAYS, weekdaysFrom, weeklyWkst } from './recurrence-weekdays';

describe('recurrence weekdays (#493)', () => {
	it('lists the days from the first day of the week', () => {
		expect(weekdaysFrom(1).map((d) => d.value)).toEqual(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
		expect(weekdaysFrom(0).map((d) => d.value)).toEqual(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
		expect(weekdaysFrom(6).map((d) => d.value)).toEqual(['SA', 'SU', 'MO', 'TU', 'WE', 'TH', 'FR']);
	});

	it('keeps every day once with its label', () => {
		for (const start of [0, 1, 6] as const) {
			expect([...weekdaysFrom(start)].sort((a, b) => a.value.localeCompare(b.value))).toEqual(
				[...RRULE_WEEKDAYS].sort((a, b) => a.value.localeCompare(b.value))
			);
		}
	});

	it('adds WKST only to rules that skip weeks, for weeks not starting on Monday', () => {
		expect(weeklyWkst(1, 2)).toBeNull(); // RFC 5545 default already
		expect(weeklyWkst(0, 1)).toBeNull(); // every week: WKST changes nothing
		expect(weeklyWkst(6, 1)).toBeNull();
		expect(weeklyWkst(0, 2)).toBe('WKST=SU');
		expect(weeklyWkst(6, 3)).toBe('WKST=SA');
	});

	it('with WKST=SU "every 2 weeks on Sunday and Monday" keeps both days in one week', () => {
		// Sunday 2026-11-01 (UTC dates: rrule.js works in UTC).
		const dtstart = new Date(Date.UTC(2026, 10, 1, 9, 0));
		const days = (rule: string) =>
			rrulestr(rule, { dtstart })
				.all((_, i) => i < 4)
				.map((d) => d.toISOString().slice(0, 10));

		const base = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO';
		expect(days(`${base};${weeklyWkst(0, 2)}`)).toEqual([
			'2026-11-01',
			'2026-11-02',
			'2026-11-15',
			'2026-11-16'
		]);
		// Without it (Monday weeks) the Sunday closes one week and the Monday opens the next.
		expect(days(base)).toEqual(['2026-11-01', '2026-11-09', '2026-11-15', '2026-11-23']);
	});
});
