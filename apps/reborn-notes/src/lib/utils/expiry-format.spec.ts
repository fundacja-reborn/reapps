import { describe, it, expect } from 'vitest';
import { formatExpiryRelative } from './expiry-format';

const NOW = new Date('2026-06-30T12:00:00.000Z').getTime();

describe('formatExpiryRelative', () => {
  it('returns null for null/invalid input', () => {
    expect(formatExpiryRelative(null, 'en', NOW)).toBeNull();
    expect(formatExpiryRelative('not-a-date', 'en', NOW)).toBeNull();
  });

  it('flags a past instant as expired with no text', () => {
    const past = new Date(NOW - 60_000).toISOString();
    const r = formatExpiryRelative(past, 'en', NOW);
    expect(r).toEqual({ text: '', expired: true });
  });

  it('treats the exact boundary as expired', () => {
    const r = formatExpiryRelative(new Date(NOW).toISOString(), 'en', NOW);
    expect(r?.expired).toBe(true);
  });

  it('formats a multi-day future as not expired (day unit)', () => {
    const future = new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString();
    const r = formatExpiryRelative(future, 'en', NOW);
    expect(r?.expired).toBe(false);
    expect(r?.text).toContain('6');
    expect(r?.text.toLowerCase()).toContain('day');
  });

  it('uses an hour unit for sub-day futures', () => {
    const future = new Date(NOW + 5 * 60 * 60 * 1000).toISOString();
    const r = formatExpiryRelative(future, 'en', NOW);
    expect(r?.expired).toBe(false);
    expect(r?.text.toLowerCase()).toContain('hour');
  });

  it('honours the locale (pl)', () => {
    const future = new Date(NOW + 6 * 24 * 60 * 60 * 1000).toISOString();
    const r = formatExpiryRelative(future, 'pl', NOW);
    // pl renders "za 6 dni" - assert the number survives, not the exact phrasing.
    expect(r?.text).toContain('6');
  });
});
