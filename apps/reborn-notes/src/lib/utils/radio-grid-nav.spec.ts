import { describe, it, expect } from 'vitest';
import { radioGridTarget } from './radio-grid-nav';

const grid = { columns: 5, rtl: false };

describe('radioGridTarget', () => {
  it('moves left/right and wraps around', () => {
    expect(radioGridTarget('ArrowRight', 0, 25, grid)).toBe(1);
    expect(radioGridTarget('ArrowRight', 24, 25, grid)).toBe(0);
    expect(radioGridTarget('ArrowLeft', 0, 25, grid)).toBe(24);
  });

  it('follows the visual direction in RTL', () => {
    const rtl = { columns: 5, rtl: true };
    expect(radioGridTarget('ArrowRight', 3, 25, rtl)).toBe(2);
    expect(radioGridTarget('ArrowLeft', 3, 25, rtl)).toBe(4);
  });

  it('moves a whole row up/down and stops at the edges', () => {
    expect(radioGridTarget('ArrowDown', 2, 25, grid)).toBe(7);
    expect(radioGridTarget('ArrowUp', 7, 25, grid)).toBe(2);
    expect(radioGridTarget('ArrowUp', 2, 25, grid)).toBe(2);
    expect(radioGridTarget('ArrowDown', 22, 25, grid)).toBe(22);
  });

  it('steps one item with up/down in a single wrapping row', () => {
    const row = { columns: 1, rtl: false };
    expect(radioGridTarget('ArrowDown', 8, 9, row)).toBe(0);
    expect(radioGridTarget('ArrowUp', 0, 9, row)).toBe(8);
  });

  it('jumps with Home/End and ignores other keys', () => {
    expect(radioGridTarget('Home', 13, 25, grid)).toBe(0);
    expect(radioGridTarget('End', 3, 25, grid)).toBe(24);
    expect(radioGridTarget('Enter', 3, 25, grid)).toBeNull();
    expect(radioGridTarget('ArrowRight', 0, 0, grid)).toBeNull();
  });
});
