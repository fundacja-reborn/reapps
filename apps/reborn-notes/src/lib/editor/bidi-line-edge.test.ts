import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { Direction } from '@codemirror/view';
import {
  lineEdgePosAtCoords,
  selectionEndOnLineEdge,
  visualLineEdge,
  visualRowEdge,
  type BidiRun,
  type LineEdgeView
} from './bidi-line-edge';

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

describe('selectionEndOnLineEdge', () => {
  // "مرحبا بالعالم 12345", 19 characters. On screen, left to right: the number
  // 1-5, then the Arabic text. Offset 14 is two spots: the left edge of the
  // line (side 1, on the "1") and the gap between number and text (side -1).
  // Offset 19 is that gap seen from the number (side -1, after the "5").
  const line = runs([0, 14, 1], [14, 19, 2]);
  const end = (index: number, assoc: number, other: [number, number] | null) =>
    selectionEndOnLineEdge(
      line,
      true,
      19,
      { index, assoc },
      other && { index: other[0], assoc: other[1] }
    );
  const lineEnd = { index: 19, assoc: 1 };

  it('takes a drag from the Arabic text to the left edge to the end of the line (#539)', () => {
    expect(end(14, 1, [2, 1])).toEqual(lineEnd);
    expect(end(14, 1, [0, 1])).toEqual(lineEnd);
  });

  it('does the same when the other end is in another line', () => {
    expect(end(14, 1, null)).toEqual(lineEnd);
  });

  it('keeps the edge of the number when the other end is inside the number', () => {
    // From between "3" and "4" to the left edge: "123" is what lies between.
    expect(end(14, 1, [17, -1])).toBeNull();
    expect(end(14, 1, [15, 1])).toBeNull();
  });

  it('selects the whole number between its two edges, in both directions', () => {
    // From the gap, on the number's side, to the left edge: 14..19 as given.
    expect(end(14, 1, [19, -1])).toBeNull();
    // From the gap, on the text's side: the editor sees both ends at 14 and
    // would select nothing.
    expect(end(14, 1, [14, -1])).toEqual(lineEnd);
    // And the anchor on the left edge with the head in the gap.
    expect(end(14, -1, [14, 1])).toBeNull();
  });

  it('collapses to the end of the line when both ends are on the left edge', () => {
    expect(end(14, 1, [14, 1])).toEqual(lineEnd);
    // The anchor a click left there earlier (shift-click on the same spot).
    expect(end(14, 1, [19, 1])).toEqual(lineEnd);
  });

  it('moves an anchor left on the line end back into the number for a head inside it', () => {
    // Click on the left edge (cursor at 19, facing out), then shift-click
    // between "2" and "3": "12" lies between the two spots.
    expect(end(19, 1, [16, -1])).toEqual({ index: 14, assoc: 1 });
    expect(end(19, 1, [5, 1])).toBeNull();
  });

  it('treats an anchor of unknown side on the line end as the inner end of the number', () => {
    expect(end(14, 1, [19, 0])).toBeNull();
  });

  it('leaves ends that are not on a visual edge alone', () => {
    expect(end(14, -1, [2, 1])).toBeNull();
    expect(end(19, -1, [2, 1])).toBeNull();
    expect(end(16, 1, [2, 1])).toBeNull();
    expect(end(0, 1, [16, 1])).toBeNull();
    expect(end(14, 0, [2, 1])).toBeNull();
  });

  it('handles the start edge of a right-to-left line that starts with a number', () => {
    // "12345 مرحبا": the number is at the right edge, the line's visual start.
    const starts = runs([0, 5, 2], [5, 11, 1]);
    const at = (index: number, assoc: number, other: [number, number] | null) =>
      selectionEndOnLineEdge(
        starts,
        true,
        11,
        { index, assoc },
        other && { index: other[0], assoc: other[1] }
      );
    expect(at(5, -1, [8, 1])).toEqual({ index: 0, assoc: -1 });
    expect(at(5, -1, null)).toEqual({ index: 0, assoc: -1 });
    expect(at(5, -1, [2, 1])).toBeNull();
    expect(at(5, -1, [0, 1])).toBeNull();
    expect(at(5, -1, [5, 1])).toEqual({ index: 0, assoc: -1 });
  });

  it('goes by visual order in a left-to-right line', () => {
    // "hello مرحبا 123" shows as "hello 123 مرحبا": the Arabic word (6-12) is
    // at the right edge, and the end of the line (15) is after "123".
    const mixed = runs([0, 6, 0], [12, 15, 2], [6, 12, 1]);
    const at = (index: number, assoc: number, other: [number, number] | null) =>
      selectionEndOnLineEdge(
        mixed,
        false,
        15,
        { index, assoc },
        other && { index: other[0], assoc: other[1] }
      );
    expect(at(6, 1, [2, 1])).toEqual({ index: 15, assoc: 1 });
    expect(at(6, 1, [13, 1])).toEqual({ index: 15, assoc: 1 });
    expect(at(6, 1, [9, 1])).toBeNull();
    expect(at(6, 1, [12, -1])).toBeNull();
  });

  it('selects a line that is one run against its direction from edge to edge', () => {
    // "12345" as a right-to-left line: the left edge is 0, the right edge 5.
    const digits = runs([0, 5, 2]);
    const at = (index: number, assoc: number, other: [number, number] | null) =>
      selectionEndOnLineEdge(
        digits,
        true,
        5,
        { index, assoc },
        other && { index: other[0], assoc: other[1] }
      );
    expect(at(0, 1, [5, -1])).toBeNull();
    expect(at(5, -1, [0, 1])).toBeNull();
    expect(at(0, 1, [3, 1])).toBeNull();
    expect(at(0, 1, null)).toEqual({ index: 5, assoc: 1 });
  });

  it('has nothing to do in a single-direction line', () => {
    const plain = runs([0, 5, 0]);
    for (const [index, assoc] of [
      [0, 1],
      [5, -1],
      [5, 1],
      [0, -1]
    ]) {
      expect(
        selectionEndOnLineEdge(plain, false, 5, { index, assoc }, { index: 2, assoc: 1 })
      ).toBeNull();
    }
  });
});

// A wrapped right-to-left paragraph, measured in Chrome on the CodeMirror
// playground (tmp/cm-try-539-drawn-range-result.txt): Arabic words with the
// Latin words "one" ... "six" and the phrase "a longer english phrase inside
// it" (106-139) between them. `ROWS` is where the browser broke it.
const PARAGRAPH = runs(
  [0, 12, 1],
  [12, 15, 2],
  [15, 28, 1],
  [28, 31, 2],
  [31, 44, 1],
  [44, 49, 2],
  [49, 62, 1],
  [62, 66, 2],
  [66, 79, 1],
  [79, 83, 2],
  [83, 96, 1],
  [96, 99, 2],
  [99, 106, 1],
  [106, 139, 2],
  [139, 151, 1]
);
const ROWS: [from: number, to: number][] = [
  [0, 22],
  [22, 44],
  [44, 67],
  [67, 90],
  [90, 115],
  [115, 140],
  [140, 151]
];

describe('visualRowEdge', () => {
  const edge = (row: [number, number], index: number, assoc: number) =>
    visualRowEdge(PARAGRAPH, true, { from: row[0], to: row[1] }, index, assoc);

  it('finds the start of a row that starts with a Latin word', () => {
    // Row "three ... four ": the right edge is the END of "three" (44-49).
    expect(edge(ROWS[2], 49, -1)).toBe(-1);
    expect(edge(ROWS[2], 49, 1)).toBe(0);
    expect(edge(ROWS[2], 44, 1)).toBe(0);
  });

  it('leaves the end of a row alone when a space hangs after the Latin word', () => {
    // "four" (62-66) is followed by the space the row wraps on; that space is
    // the visual end, and the stock answer (67) is already the end of the row.
    expect(edge(ROWS[2], 67, -1)).toBe(0);
    expect(edge(ROWS[2], 62, 1)).toBe(0);
  });

  it('finds both edges where a Latin phrase wraps', () => {
    // Row 90..115 ends in "a longer " (106-115), the first part of the phrase.
    expect(edge(ROWS[4], 106, 1)).toBe(1);
    // Row 115..140 starts with the rest of it (115-139).
    expect(edge(ROWS[5], 139, -1)).toBe(-1);
  });

  it('has nothing to correct for a Latin word inside a row', () => {
    // "one" (12-15) sits in the middle of row 0..22.
    expect(edge(ROWS[0], 12, 1)).toBe(0);
    expect(edge(ROWS[0], 15, -1)).toBe(0);
  });

  it('is visualLineEdge when the row is the whole line', () => {
    const line = runs([0, 14, 1], [14, 19, 2]);
    expect(visualRowEdge(line, true, { from: 0, to: 19 }, 14, 1)).toBe(1);
    expect(visualRowEdge(line, true, { from: 0, to: 19 }, 14, -1)).toBe(0);
  });
});

describe('lineEdgePosAtCoords', () => {
  interface Layout {
    /** Text before the line under test (other lines of the note). */
    before?: string;
    length: number;
    runs: BidiRun[];
    /** Rows as offsets into the line; one row when the line does not wrap. */
    rows?: [number, number][];
    rtl?: boolean;
    wrapping?: boolean;
    /** `coordsAtPos` gives nothing (position not drawn). */
    blind?: boolean;
  }

  // Stands in for the editor's layout: `stock` is what CodeMirror's own
  // `posAndSideAtCoords` answers for the point asked about.
  function setup(layout: Layout) {
    const before = layout.before ?? '';
    const rows = layout.rows ?? [[0, layout.length]];
    const state = EditorState.create({ doc: before + 'x'.repeat(layout.length) });
    let stock: { pos: number; assoc: -1 | 1 } | null = null;
    const coordsAtPos = vi.fn((pos: number, side: number = 1) => {
      if (layout.blind) return null;
      // The character on that side of the position, and the row it is on.
      const char = Math.min(
        Math.max(pos - before.length - (side < 0 ? 1 : 0), 0),
        layout.length - 1
      );
      const row = rows.findIndex(([from, to]) => char >= from && char < to);
      return { left: 0, right: 0, top: row * 30, bottom: row * 30 + 22 };
    });
    const view = {
      state,
      lineWrapping: layout.wrapping ?? true,
      posAndSideAtCoords: () => stock,
      coordsAtPos,
      bidiSpans: () => layout.runs,
      textDirectionAt: () => ((layout.rtl ?? true) ? Direction.RTL : Direction.LTR)
    } as unknown as LineEdgeView;
    const posAtCoords = lineEdgePosAtCoords(view);
    const at = (pos: number, assoc: -1 | 1) => {
      stock = { pos: before.length + pos, assoc };
      const result = posAtCoords({ x: 0, y: 0 }, false);
      return result - before.length;
    };
    return { at, posAtCoords, coordsAtPos, clear: () => (stock = null) };
  }

  // "مرحبا بالعالم hello", 19 characters.
  const endsInWord = { length: 19, runs: runs([0, 14, 1], [14, 19, 2]) };

  it('gives the end of the line for its left edge, on the Latin word (#539)', () => {
    const { at } = setup(endsInWord);
    expect(at(14, 1)).toBe(19);
  });

  it('passes every other point through', () => {
    const { at, coordsAtPos } = setup(endsInWord);
    expect(at(14, -1)).toBe(14);
    expect(at(16, 1)).toBe(16);
    expect(at(5, 1)).toBe(5);
    expect(at(0, 1)).toBe(0);
    // Only an end of the word, seen from inside it, needs the layout.
    expect(coordsAtPos).not.toHaveBeenCalled();
    // The gap between text and word, seen from the word: its end is in the
    // middle of the row, so it stays.
    expect(at(19, -1)).toBe(19);
  });

  it('answers in document positions for a line further down the note', () => {
    const { at } = setup({ ...endsInWord, before: 'first line\n' });
    expect(at(14, 1)).toBe(19);
    expect(at(7, 1)).toBe(7);
  });

  it('does not measure rows when the editor does not wrap lines', () => {
    const { at, coordsAtPos } = setup({ ...endsInWord, wrapping: false });
    expect(at(14, 1)).toBe(19);
    expect(coordsAtPos).not.toHaveBeenCalled();
  });

  it('falls back to the whole line when the layout cannot tell the row', () => {
    const { at } = setup({ ...endsInWord, blind: true });
    expect(at(14, 1)).toBe(19);
  });

  it('keeps a null answer (precise query off the text)', () => {
    const { posAtCoords, clear } = setup(endsInWord);
    clear();
    expect(posAtCoords({ x: 0, y: 0 })).toBeNull();
  });

  it('gives the edges of each row of a wrapped paragraph', () => {
    const { at } = setup({ length: 151, runs: PARAGRAPH, rows: ROWS });
    // [what the stock method answers at the left and the right edge of the
    // editor, per row] -> the row's end and start in the text.
    const edges: [left: [number, -1 | 1], right: [number, -1 | 1]][] = [
      [
        [22, -1],
        [0, 1]
      ],
      [
        [44, -1],
        [22, 1]
      ],
      [
        [67, -1],
        [49, -1]
      ],
      [
        [90, -1],
        [67, 1]
      ],
      [
        [106, 1],
        [90, 1]
      ],
      [
        [140, -1],
        [139, -1]
      ],
      [
        [151, -1],
        [140, 1]
      ]
    ];
    edges.forEach(([left, right], row) => {
      expect([at(...right), at(...left)]).toEqual(ROWS[row]);
    });
  });

  it('leaves the ends of a Latin word inside a row where they are', () => {
    const { at } = setup({ length: 151, runs: PARAGRAPH, rows: ROWS });
    // "one" (12-15) and "two" (28-31) have Arabic text on both sides.
    expect(at(12, 1)).toBe(12);
    expect(at(15, -1)).toBe(15);
    expect(at(28, 1)).toBe(28);
    expect(at(31, -1)).toBe(31);
    // Inside the phrase, on both of its rows.
    expect(at(110, 1)).toBe(110);
    expect(at(120, -1)).toBe(120);
  });

  it('works for a left-to-right line that ends in an Arabic word', () => {
    // "hello مرحبا": the right edge is the start of the Arabic word.
    const { at } = setup({ length: 11, runs: runs([0, 6, 0], [6, 11, 1]), rtl: false });
    expect(at(6, 1)).toBe(11);
    expect(at(6, -1)).toBe(6);
  });
});
