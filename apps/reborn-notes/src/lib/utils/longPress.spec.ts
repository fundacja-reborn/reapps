import { describe, it, expect } from 'vitest';
import { exceedsMoveTolerance } from './longPress.svelte';

describe('exceedsMoveTolerance', () => {
  it('returns false when pointer has not moved', () => {
    expect(exceedsMoveTolerance(100, 100, 100, 100, 10)).toBe(false);
  });

  it('returns false when movement is within tolerance', () => {
    expect(exceedsMoveTolerance(100, 100, 105, 100, 10)).toBe(false);
    expect(exceedsMoveTolerance(100, 100, 100, 109, 10)).toBe(false);
  });

  it('returns true when movement exceeds tolerance (vertical scroll)', () => {
    expect(exceedsMoveTolerance(100, 100, 100, 115, 10)).toBe(true);
  });

  it('returns true on diagonal movement past threshold', () => {
    // diag of 8,8 = sqrt(128) ≈ 11.3 — over 10
    expect(exceedsMoveTolerance(100, 100, 108, 108, 10)).toBe(true);
  });

  it('uses Euclidean (not Manhattan) distance', () => {
    // diag of 7,7 = sqrt(98) ≈ 9.9 — under 10 even though |dx|+|dy|=14
    expect(exceedsMoveTolerance(100, 100, 107, 107, 10)).toBe(false);
  });

  it('respects custom tolerance', () => {
    expect(exceedsMoveTolerance(100, 100, 100, 105, 4)).toBe(true);
    expect(exceedsMoveTolerance(100, 100, 100, 105, 5)).toBe(false);
  });
});
