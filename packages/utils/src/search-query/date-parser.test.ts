import { describe, expect, it } from 'vitest';
import { parseDateExpression, resolveDateRef } from './date-parser';

describe('parseDateExpression', () => {
  it('parses absolute date as on-that-day', () => {
    expect(parseDateExpression('2026-05-06')).toEqual({
      op: 'on',
      date: { kind: 'date', year: 2026, month: 5, day: 6 }
    });
  });

  it('parses < absolute as before', () => {
    expect(parseDateExpression('<2026-01-01')).toEqual({
      op: 'before',
      date: { kind: 'date', year: 2026, month: 1, day: 1 }
    });
  });

  it('parses > absolute as after', () => {
    expect(parseDateExpression('>2026-01-01')).toEqual({
      op: 'after',
      date: { kind: 'date', year: 2026, month: 1, day: 1 }
    });
  });

  it('parses range with ..', () => {
    expect(parseDateExpression('2026-01-01..2026-02-01')).toEqual({
      op: 'between',
      from: { kind: 'date', year: 2026, month: 1, day: 1 },
      to: { kind: 'date', year: 2026, month: 2, day: 1 }
    });
  });

  it('flips relative <Nd to after-(N-days-ago)', () => {
    expect(parseDateExpression('<7d')).toEqual({
      op: 'after',
      date: { kind: 'days-ago', n: 7 }
    });
  });

  it('flips relative >Nd to before-(N-days-ago)', () => {
    expect(parseDateExpression('>14d')).toEqual({
      op: 'before',
      date: { kind: 'days-ago', n: 14 }
    });
  });

  it('parses week and month units as days', () => {
    expect(parseDateExpression('<2w')).toEqual({
      op: 'after',
      date: { kind: 'days-ago', n: 14 }
    });
    expect(parseDateExpression('>1m')).toEqual({
      op: 'before',
      date: { kind: 'days-ago', n: 30 }
    });
  });

  it('parses today and yesterday', () => {
    expect(parseDateExpression('today')).toEqual({
      op: 'on',
      date: { kind: 'today' }
    });
    expect(parseDateExpression('yesterday')).toEqual({
      op: 'on',
      date: { kind: 'yesterday' }
    });
  });

  it('rejects malformed dates', () => {
    expect(parseDateExpression('2026-13-01')).toBeNull();
    expect(parseDateExpression('2026-02-30')).toBeNull();
    expect(parseDateExpression('not-a-date')).toBeNull();
    expect(parseDateExpression('')).toBeNull();
    expect(parseDateExpression('<')).toBeNull();
    expect(parseDateExpression('<-7d')).toBeNull();
  });

  it('rejects malformed ranges', () => {
    expect(parseDateExpression('2026-01-01..')).toBeNull();
    expect(parseDateExpression('..2026-01-01')).toBeNull();
    expect(parseDateExpression('2026-01-01..bad')).toBeNull();
  });

  it('is case-insensitive for keywords', () => {
    expect(parseDateExpression('TODAY')).toEqual({
      op: 'on',
      date: { kind: 'today' }
    });
    expect(parseDateExpression('Yesterday')).toEqual({
      op: 'on',
      date: { kind: 'yesterday' }
    });
  });
});

describe('resolveDateRef', () => {
  const now = new Date(2026, 4, 6, 14, 30, 0); // 2026-05-06 14:30 local

  it('resolves absolute date to start/end of that day', () => {
    const { startOfDay, endOfDay } = resolveDateRef(
      { kind: 'date', year: 2026, month: 1, day: 15 },
      now
    );
    expect(startOfDay).toEqual(new Date(2026, 0, 15, 0, 0, 0, 0));
    expect(endOfDay).toEqual(new Date(2026, 0, 15, 23, 59, 59, 999));
  });

  it('resolves today to today', () => {
    const { startOfDay, endOfDay } = resolveDateRef({ kind: 'today' }, now);
    expect(startOfDay).toEqual(new Date(2026, 4, 6, 0, 0, 0, 0));
    expect(endOfDay).toEqual(new Date(2026, 4, 6, 23, 59, 59, 999));
  });

  it('resolves yesterday to previous day', () => {
    const { startOfDay, endOfDay } = resolveDateRef({ kind: 'yesterday' }, now);
    expect(startOfDay).toEqual(new Date(2026, 4, 5, 0, 0, 0, 0));
    expect(endOfDay).toEqual(new Date(2026, 4, 5, 23, 59, 59, 999));
  });

  it('resolves days-ago by subtracting days', () => {
    const { startOfDay } = resolveDateRef({ kind: 'days-ago', n: 7 }, now);
    expect(startOfDay).toEqual(new Date(2026, 3, 29, 0, 0, 0, 0));
  });

  it('handles month boundary in days-ago', () => {
    const earlyMay = new Date(2026, 4, 2, 12, 0, 0); // 2026-05-02
    const { startOfDay } = resolveDateRef({ kind: 'days-ago', n: 5 }, earlyMay);
    expect(startOfDay).toEqual(new Date(2026, 3, 27, 0, 0, 0, 0));
  });
});
