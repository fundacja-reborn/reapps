import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTimeOfDay } from '@reborn/i18n/config';
import { formatSettingsDateTime, formatSnapshotDueDate } from './task-formatting.service';

describe('formatSettingsDateTime', () => {
	// Local time, written without a zone: the same wall clock on every machine.
	const afternoon = '2026-11-06T17:13:00';

	it.each([
		['DD/MM/YYYY', '06/11/2026'],
		['DD.MM.YYYY', '06.11.2026'],
		['MM/DD/YYYY', '11/06/2026'],
		['YYYY-MM-DD', '2026-11-06'],
		['YYYY/MM/DD', '2026/11/06'],
		['YYYY.MM.DD', '2026.11.06']
	])('puts the date in the %s format before the time', (format, expected) => {
		expect(formatSettingsDateTime(afternoon, format, '24h', 'en')).toBe(`${expected}, 17:13`);
	});

	it.each(['en', 'pl', 'de', 'fr', 'es', 'ar'])(
		'takes the date from the setting, never from %s (#595)',
		(locale) => {
			for (const clock of ['24h', '12h']) {
				expect(formatSettingsDateTime(afternoon, 'YYYY-MM-DD', clock, locale)).toBe(
					`2026-11-06, ${formatTimeOfDay(afternoon, locale, clock)}`
				);
			}
		}
	);

	it('words the AM/PM marker in the app language and keeps digits 0-9', () => {
		const arabic = formatSettingsDateTime(afternoon, 'YYYY/MM/DD', '12h', 'ar');
		expect(arabic.startsWith('2026/11/06, 5:13')).toBe(true);
		expect(arabic).toContain('م');
		expect(arabic).not.toMatch(/[٠-٩]/);
	});

	it('takes a Date as well as an ISO string, and formats before the language is loaded', () => {
		const date = new Date(2026, 10, 6, 17, 13);
		expect(formatSettingsDateTime(date, 'DD.MM.YYYY', '24h', 'pl')).toBe('06.11.2026, 17:13');
		expect(formatSettingsDateTime(date, 'DD.MM.YYYY', '24h', undefined)).toBe('06.11.2026, 17:13');
	});
});

describe('formatSnapshotDueDate', () => {
	// A date-only task stores its calendar day as UTC midnight.
	const dateOnly = '2026-11-25T00:00:00.000Z';
	const timed = '2026-11-25T09:30:00.000Z';
	const clockTime = /\d{1,2}:\d{2}/;

	it('shows a date-only due date without a time, on its UTC calendar day (public page)', () => {
		expect(formatSnapshotDueDate(dateOnly, false, 'pl', null)).toBe('25.11.2026');
		expect(formatSnapshotDueDate(dateOnly, false, 'en', null)).toBe('11/25/2026');
		expect(formatSnapshotDueDate(dateOnly, undefined, 'de', null)).not.toMatch(clockTime);
	});

	it('shows a date-only due date without a time in the owner preview', () => {
		expect(formatSnapshotDueDate(dateOnly, false, 'en', '24h')).toBe('Nov 25, 2026');
		expect(formatSnapshotDueDate(dateOnly, false, 'pl', '12h')).not.toMatch(clockTime);
	});

	it('keeps digits 0-9 in Arabic', () => {
		expect(formatSnapshotDueDate(dateOnly, false, 'ar', null)).not.toMatch(/[٠-٩]/);
		expect(formatSnapshotDueDate(dateOnly, false, 'ar', '24h')).not.toMatch(/[٠-٩]/);
	});

	it('shows the time of a timed due date, on the clock of the page', () => {
		const date = new Date(timed);
		expect(formatSnapshotDueDate(timed, true, 'pl', null)).toBe(date.toLocaleString('pl'));
		expect(formatSnapshotDueDate(timed, true, 'en', '12h')).toBe(formatDateTime(date, 'en', '12h'));
		expect(formatSnapshotDueDate(timed, true, 'en', '12h')).toMatch(clockTime);
	});

	it('returns an empty text without a date and the raw value when it is not a date', () => {
		expect(formatSnapshotDueDate(null, false, 'en', null)).toBe('');
		expect(formatSnapshotDueDate('', true, 'en', '24h')).toBe('');
		expect(formatSnapshotDueDate('not a date', false, 'en', null)).toBe('not a date');
	});
});
