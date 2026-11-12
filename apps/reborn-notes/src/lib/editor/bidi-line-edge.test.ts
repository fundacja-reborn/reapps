import { describe, expect, it } from 'vitest';
import { visualLineEdge, type BidiRun } from './bidi-line-edge';

const runs = (...spans: [from: number, to: number, level: number][]): BidiRun[] =>
  spans.map(([from, to, level]) => ({ from, to, level }));

// The runs below are what `EditorView.bidiSpans` reports in Chrome for the
// line in the comment, in visual order from the line's start side.

describe('visualLineEdge', () => {
  // "مرحبا بالعالم 12345": the number is at the left edge, the line's visual end.
  const rtlEndingInNumber = runs([0, 14, 1], [14, 19, 2]);

  it('finds the end of a right-to-left line that ends in a number (#539)', () => {
    expect(visualLineEdge(rtlEndingInNumber, true, 14, 1)).toBe(1);
  });

  it('leaves the spot between the Arabic text and the number alone', () => {
    expect(visualLineEdge(rtlEndingInNumber, true, 14, -1)).toBe(0);
    expect(visualLineEdge(rtlEndingInNumber, true, 19, -1)).toBe(0);
  });

  it('leaves a cursor that is already on the edge of the line alone', () => {
    expect(visualLineEdge(rtlEndingInNumber, true, 19, 1)).toBe(0);
    expect(visualLineEdge(rtlEndingInNumber, true, 0, -1)).toBe(0);
    expect(visualLineEdge(rtlEndingInNumber, true, 0, 1)).toBe(0);
  });

  it('ignores a cursor without a side', () => {
    expect(visualLineEdge(rtlEndingInNumber, true, 14, 0)).toBe(0);
  });

  it('ignores a cursor tied to the run on the other side of the position', () => {
    expect(visualLineEdge(rtlEndingInNumber, true, 14, 1, 1)).toBe(0);
    expect(visualLineEdge(rtlEndingInNumber, true, 14, 1, 2)).toBe(1);
  });

  it('finds the start of a right-to-left line that starts with a number', () => {
    // "12345 مرحبا": the number is at the right edge, the line's visual start.
    const line = runs([0, 5, 2], [5, 11, 1]);
    expect(visualLineEdge(line, true, 5, -1)).toBe(-1);
    expect(visualLineEdge(line, true, 5, 1)).toBe(0);
    expect(visualLineEdge(line, true, 0, 1)).toBe(0);
    expect(visualLineEdge(line, true, 11, 1)).toBe(0);
  });

  it('finds the end of a left-to-right line that ends in an Arabic word', () => {
    // "hello مرحبا": the Arabic word starts at the right edge.
    const line = runs([0, 6, 0], [6, 11, 1]);
    expect(visualLineEdge(line, false, 6, 1)).toBe(1);
    expect(visualLineEdge(line, false, 6, -1)).toBe(0);
    expect(visualLineEdge(line, false, 11, -1)).toBe(0);
  });

  it('goes by visual order, not by which run comes last in the text', () => {
    // "hello مرحبا 123" shows as "hello 123 مرحبا": the Arabic word is at the
    // right edge although the number follows it in the text.
    const line = runs([0, 6, 0], [12, 15, 2], [6, 12, 1]);
    expect(visualLineEdge(line, false, 6, 1)).toBe(1);
    expect(visualLineEdge(line, false, 6, -1)).toBe(0);
    expect(visualLineEdge(line, false, 12, 1)).toBe(0);
    expect(visualLineEdge(line, false, 15, -1)).toBe(0);
  });

  it('has nothing to correct when the runs at both edges go with the line', () => {
    // "مرحبا hello عالم": the Latin word is in the middle.
    const line = runs([0, 6, 1], [6, 11, 2], [11, 16, 1]);
    for (const index of [0, 6, 11, 16]) {
      expect(visualLineEdge(line, true, index, 1)).toBe(0);
      expect(visualLineEdge(line, true, index, -1)).toBe(0);
    }
  });

  it('handles a line that is one run against its direction', () => {
    // "12345" below an Arabic paragraph: a right-to-left line of digits only.
    const line = runs([0, 5, 2]);
    expect(visualLineEdge(line, true, 0, 1)).toBe(1);
    expect(visualLineEdge(line, true, 5, -1)).toBe(-1);
    expect(visualLineEdge(line, true, 0, -1)).toBe(0);
    expect(visualLineEdge(line, true, 5, 1)).toBe(0);
  });

  it('leaves single-direction lines alone', () => {
    for (const assoc of [-1, 1]) {
      expect(visualLineEdge(runs([0, 5, 0]), false, 0, assoc)).toBe(0);
      expect(visualLineEdge(runs([0, 5, 0]), false, 5, assoc)).toBe(0);
      expect(visualLineEdge(runs([0, 5, 1]), true, 0, assoc)).toBe(0);
      expect(visualLineEdge(runs([0, 5, 1]), true, 5, assoc)).toBe(0);
    }
  });

  it('copes with an empty line', () => {
    expect(visualLineEdge([], true, 0, 1)).toBe(0);
    expect(visualLineEdge(runs([0, 0, 1]), true, 0, 1)).toBe(0);
    expect(visualLineEdge(runs([0, 0, 0]), true, 0, 1)).toBe(0);
  });
});
