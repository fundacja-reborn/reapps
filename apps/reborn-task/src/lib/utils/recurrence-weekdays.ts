/**
 * Week-start-aware pieces of the weekly recurrence editor (issue #493).
 *
 * Pure (type-only dependency on @reborn/i18n) so it is unit-testable without
 * the dialog. Days use the `Date#getDay()` numbering of `WeekStartDay`.
 */
import type { WeekStartDay } from '@reborn/i18n';

/** RRULE `BYDAY` codes with their i18n label keys, in `Date#getDay()` order (0 = Sunday). */
export const RRULE_WEEKDAYS = [
	{ value: 'SU', label: 'sunday' },
	{ value: 'MO', label: 'monday' },
	{ value: 'TU', label: 'tuesday' },
	{ value: 'WE', label: 'wednesday' },
	{ value: 'TH', label: 'thursday' },
	{ value: 'FR', label: 'friday' },
	{ value: 'SA', label: 'saturday' }
] as const;

export type RRuleWeekday = (typeof RRULE_WEEKDAYS)[number];

/** The seven days starting on the user's first day of the week (checkbox order). */
export function weekdaysFrom(weekStart: WeekStartDay): RRuleWeekday[] {
	return RRULE_WEEKDAYS.map((_, i) => RRULE_WEEKDAYS[(weekStart + i) % 7]);
}

/**
 * The `WKST` part for a weekly rule, or `null` when it would change nothing.
 *
 * `WKST` decides which week a day belongs to, which only matters for weekly
 * rules that skip weeks: "every 2 weeks on Sunday and Monday" keeps Sunday
 * and Monday together when the week starts on Sunday, but splits them across
 * two weeks with the RFC 5545 default (Monday). Rules repeating every week,
 * and users whose week starts on Monday, get no `WKST` - their RRULE strings
 * stay exactly what they were before the setting existed. The value is
 * fixed when the rule is saved: changing the setting later does not move
 * the occurrences of existing tasks.
 */
export function weeklyWkst(weekStart: WeekStartDay, interval: number): string | null {
	if (weekStart === 1 || interval <= 1) return null;
	return `WKST=${RRULE_WEEKDAYS[weekStart].value}`;
}
