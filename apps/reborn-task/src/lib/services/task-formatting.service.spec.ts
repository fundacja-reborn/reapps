import { describe, expect, it } from 'vitest';
import { formatTimeOfDay } from '@reborn/i18n/config';
import { formatSettingsDateTime } from './task-formatting.service';

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
