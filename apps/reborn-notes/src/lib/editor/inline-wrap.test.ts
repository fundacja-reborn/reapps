import { describe, it, expect } from 'vitest';
import { computeInlineWrap } from './inline-wrap';

describe('computeInlineWrap', () => {
  it('inserts empty markers with the caret between them for no selection', () => {
    expect(computeInlineWrap('', '**')).toEqual({ insert: '****', anchor: 2, head: 2 });
  });

  it('wraps a word and selects the whole result', () => {
    expect(computeInlineWrap('word', '**')).toEqual({ insert: '**word**', anchor: 0, head: 8 });
  });

  it('toggles an already-wrapped word off', () => {
    expect(computeInlineWrap('**word**', '**')).toEqual({ insert: 'word', anchor: 0, head: 4 });
  });

  it('keeps surrounding whitespace outside the markers', () => {
    expect(computeInlineWrap(' word ', '**')).toEqual({ insert: ' **word** ', anchor: 1, head: 9 });
  });

  it('drops empty markers for a whitespace-only selection', () => {
    expect(computeInlineWrap('   ', '**')).toEqual({ insert: '   ****', anchor: 5, head: 5 });
  });

  it('works with single-character markers (italic)', () => {
    expect(computeInlineWrap('x', '_')).toEqual({ insert: '_x_', anchor: 0, head: 3 });
  });

  it('works with strikethrough', () => {
    expect(computeInlineWrap('x', '~~')).toEqual({ insert: '~~x~~', anchor: 0, head: 5 });
  });

  it('works with inline code', () => {
    expect(computeInlineWrap('x', '`')).toEqual({ insert: '`x`', anchor: 0, head: 3 });
  });

  it('toggles italic off', () => {
    expect(computeInlineWrap('_x_', '_')).toEqual({ insert: 'x', anchor: 0, head: 1 });
  });

  it('does not toggle off when only one side is marked', () => {
    expect(computeInlineWrap('_x', '_')).toEqual({ insert: '__x_', anchor: 0, head: 4 });
  });
});
