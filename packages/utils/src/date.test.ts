import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DATE_FORMATS,
  SETTINGS_DATE_FORMAT_OPTIONS,
  formatDateWithSetting
} from './date';

describe('formatDateWithSetting', () => {
  const day = new Date(2026, 10, 7, 12, 0);

  it.each([
    ['DD/MM/YYYY', '07/11/2026'],
    ['DD.MM.YYYY', '07.11.2026'],
    ['YYYY-MM-DD', '2026-11-07'],
    ['YYYY/MM/DD', '2026/11/07'],
    ['YYYY.MM.DD', '2026.11.07'],
    ['MM/DD/YYYY', '11/07/2026']
  ])('writes %s as %s', (format, expected) => {
    expect(formatDateWithSetting(day, format)).toBe(expected);
  });

  it('formats every offered format explicitly, none through the ISO fallback', () => {
    const iso = formatDateWithSetting(day, 'YYYY-MM-DD');
    const viaFallback = SETTINGS_DATE_FORMATS.filter(
      (format) => format !== 'YYYY-MM-DD' && formatDateWithSetting(day, format) === iso
    );
    expect(viaFallback).toEqual([]);
  });

  it('falls back to ISO for a format it does not know, e.g. from a newer client', () => {
    expect(formatDateWithSetting(day, 'YYYY年MM月DD日')).toBe('2026-11-07');
    expect(formatDateWithSetting(day, '')).toBe('2026-11-07');
  });
});

describe('SETTINGS_DATE_FORMAT_OPTIONS', () => {
  it('offers every format once, in list order', () => {
    expect(SETTINGS_DATE_FORMAT_OPTIONS.map((o) => o.value)).toEqual([...SETTINGS_DATE_FORMATS]);
  });

  it('labels each format with 31 December 2024 written in it', () => {
    expect(SETTINGS_DATE_FORMAT_OPTIONS.map((o) => o.label)).toEqual([
      '31/12/2024',
      '31.12.2024',
      '2024-12-31',
      '2024/12/31',
      '2024.12.31',
      '12/31/2024'
    ]);
  });
});
