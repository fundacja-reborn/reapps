import { describe, it, expect } from 'vitest';
import { distanceFromInlineStart, inlineDelta } from './edge-swipe';

describe('edge swipe helpers', () => {
  it('measures from the left edge in LTR and from the right edge in RTL', () => {
    expect(distanceFromInlineStart(10, 400, 'ltr')).toBe(10);
    expect(distanceFromInlineStart(390, 400, 'rtl')).toBe(10);
    expect(distanceFromInlineStart(10, 400, 'rtl')).toBe(390);
  });

  it('reports movement towards inline-end as positive in both directions', () => {
    expect(inlineDelta(10, 110, 'ltr')).toBe(100);
    expect(inlineDelta(390, 290, 'rtl')).toBe(100);
    expect(inlineDelta(390, 290, 'ltr')).toBe(-100);
  });
});
