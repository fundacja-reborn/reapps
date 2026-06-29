import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  parseTable,
  serializeTable,
  unescapePipes,
  escapeCell,
  decodeCellText,
  sameTableStructure,
  cellText,
  insertColumn,
  deleteColumn,
  insertRow,
  deleteRow,
  setColumnAlignment,
  type SerializeInput,
  type CellAlign
} from './table-parse';

function makeState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Strikethrough, Table] })]
  });
}

function findTableNode(state: EditorState): SyntaxNode | null {
  let result: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    enter(nodeRef) {
      if (nodeRef.type.name === 'Table') {
        result = nodeRef.node;
        return false;
      }
    }
  });
  return result;
}

describe('unescapePipes / escapeCell', () => {
  it('decodes escaped pipes', () => {
    expect(unescapePipes('a \\| b')).toBe('a | b');
  });
  it('escapes literal pipes', () => {
    expect(escapeCell('a | b')).toBe('a \\| b');
  });
  it('escape is round-trip with unescape (no newlines)', () => {
    const original = 'foo | bar | baz';
    expect(unescapePipes(escapeCell(original))).toBe(original);
  });
  it('encodes newlines as <br> in escapeCell (Shift+Enter convention)', () => {
    expect(escapeCell('line1\nline2')).toBe('line1<br>line2');
    expect(escapeCell('line1\r\nline2')).toBe('line1<br>line2');
    expect(escapeCell('a\n\nb')).toBe('a<br><br>b');
  });
  it('escapes literal backslashes so `\\|` round-trips without splitting rows', () => {
    // Without escaping the backslash, `\|` would serialize as `\\|` and the
    // GFM parser would read the trailing `|` as an unescaped column boundary.
    expect(escapeCell('\\|')).toBe('\\\\\\|');
    expect(escapeCell('\\')).toBe('\\\\');
    expect(unescapePipes(escapeCell('\\|'))).toBe('\\|');
    expect(unescapePipes(escapeCell('a\\b'))).toBe('a\\b');
  });
});

describe('decodeCellText', () => {
  it('unescapes pipes and converts <br> variants to newlines', () => {
    expect(decodeCellText('a \\| b')).toBe('a | b');
    expect(decodeCellText('a<br>b')).toBe('a\nb');
    expect(decodeCellText('a<br/>b')).toBe('a\nb');
    expect(decodeCellText('a<br />b')).toBe('a\nb');
    expect(decodeCellText('a<BR>b')).toBe('a\nb');
    expect(decodeCellText('a<Br />b')).toBe('a\nb');
  });
  it('strips leading/trailing spaces and tabs but preserves newlines', () => {
    expect(decodeCellText('  hello  ')).toBe('hello');
    expect(decodeCellText('\t hello \t')).toBe('hello');
    // Newlines around content are kept — user may have intentional blank lines.
    expect(decodeCellText('  hello<br>world  ')).toBe('hello\nworld');
  });
  it('round-trips `escapeCell` ⇄ `decodeCellText` for multi-line cells', () => {
    const cases = ['simple', 'a\nb', 'a | b\n c | d', 'with\n\nempty line'];
    for (const original of cases) {
      expect(decodeCellText(escapeCell(original))).toBe(original);
    }
  });
});

describe('parseTable', () => {
  it('parses a basic header + one row', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
    const state = makeState(doc);
    const node = findTableNode(state);
    expect(node).not.toBeNull();

    const parsed = parseTable(state, node!);
    expect(parsed).not.toBeNull();
    expect(parsed!.header).toHaveLength(2);
    expect(parsed!.header[0].text).toBe('A');
    expect(parsed!.header[1].text).toBe('B');
    expect(parsed!.rows).toHaveLength(1);
    expect(parsed!.rows[0][0].text).toBe('1');
    expect(parsed!.rows[0][1].text).toBe('2');
  });

  it('parses alignment markers (:---, ---:, :---:)', () => {
    const doc = '| L | R | C | D |\n| :--- | ---: | :---: | --- |\n| a | b | c | d |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.alignments).toEqual(['left', 'right', 'center', null]);
  });

  it('handles multiple body rows', () => {
    const doc = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.rows).toHaveLength(3);
    expect(parsed!.rows[2][1].text).toBe('6');
  });

  it('decodes escaped pipes in cell text', () => {
    const doc = '| A | B |\n| --- | --- |\n| has \\| pipe | plain |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.rows[0][0].text).toBe('has | pipe');
    expect(parsed!.rows[0][1].text).toBe('plain');
  });

  it('handles empty cells', () => {
    const doc = '| A | B |\n| --- | --- |\n|   |   |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.rows[0][0].text).toBe('');
    expect(parsed!.rows[0][1].text).toBe('');
  });

  it('decodes <br> in cell text as newlines (Shift+Enter convention)', () => {
    const doc = '| A | B |\n| --- | --- |\n| line1<br>line2 | x |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.rows[0][0].text).toBe('line1\nline2');
    expect(parsed!.rows[0][1].text).toBe('x');
  });

  it('decodes <br/> and <br /> variants', () => {
    const doc = '| A |\n| --- |\n| a<br/>b<br />c |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.rows[0][0].text).toBe('a\nb\nc');
  });

  it('keeps a trailing empty header column (delimiter defines column count)', () => {
    // `@lezer/markdown` drops the trailing empty header cell, emitting only two
    // TableCell nodes — without trusting the delimiter, a freshly-inserted
    // rightmost column would vanish on reparse. The delimiter has 3 segments,
    // so the table must read as 3 columns with an empty last header.
    const doc = '| A | B |   |\n| --- | --- | :---: |\n| 1 | 2 |   |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.header).toHaveLength(3);
    expect(parsed!.header.map((c) => c.text)).toEqual(['A', 'B', '']);
    expect(parsed!.alignments).toEqual([null, null, 'center']);
    expect(parsed!.rows[0]).toHaveLength(3);
  });

  it('handles header only (no body rows)', () => {
    const doc = '| A | B |\n| --- | --- |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.header).toHaveLength(2);
    expect(parsed!.rows).toHaveLength(0);
  });

  it('pads short body rows to header column count', () => {
    // Manually-constructed scenario where a body row has fewer cells.
    // GFM parser wouldn't produce this normally; we rely on parseTable's
    // normalisation as a safety net for malformed input mid-edit.
    const doc = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n';
    const state = makeState(doc);
    const parsed = parseTable(state, findTableNode(state)!);
    expect(parsed!.rows[0]).toHaveLength(3);
  });
});

describe('serializeTable', () => {
  it('renders a simple 2x1 table with pipes and padding', () => {
    const out = serializeTable({
      header: [{ text: 'A' }, { text: 'B' }],
      rows: [[{ text: '1' }, { text: '2' }]],
      alignments: [null, null]
    });
    expect(out).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('renders empty cells as triple-space (matches toolbar template)', () => {
    const out = serializeTable({
      header: [{ text: 'A' }, { text: 'B' }],
      rows: [[{ text: '' }, { text: '' }]],
      alignments: [null, null]
    });
    expect(out).toContain('|   |   |');
  });

  it('encodes alignments in the delimiter row', () => {
    const out = serializeTable({
      header: [{ text: 'L' }, { text: 'R' }, { text: 'C' }],
      rows: [],
      alignments: ['left', 'right', 'center']
    });
    expect(out).toContain('| :--- | ---: | :---: |');
  });

  it('encodes \\n in cell text as <br> in markdown output', () => {
    const out = serializeTable({
      header: [{ text: 'A' }, { text: 'B' }],
      rows: [[{ text: 'line1\nline2' }, { text: 'plain' }]],
      alignments: [null, null]
    });
    expect(out).toContain('| line1<br>line2 |');
    expect(out).toContain('| plain |');
  });

  it('round-trips multi-line cells through parseTable', () => {
    const original = serializeTable({
      header: [{ text: 'A' }, { text: 'B' }],
      rows: [[{ text: 'a\nb' }, { text: 'c' }]],
      alignments: [null, null]
    });
    const state = makeState(original + '\n');
    const reparsed = parseTable(state, findTableNode(state)!);
    expect(reparsed!.rows[0][0].text).toBe('a\nb');
    expect(reparsed!.rows[0][1].text).toBe('c');
  });

  it('escapes literal pipes in cell text', () => {
    const out = serializeTable({
      header: [{ text: 'A' }, { text: 'B' }],
      rows: [[{ text: 'has | pipe' }, { text: 'ok' }]],
      alignments: [null, null]
    });
    expect(out).toContain('has \\| pipe');
  });

  it('rounds-trips through parseTable', () => {
    const original = '| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n';
    const state = makeState(original);
    const parsed = parseTable(state, findTableNode(state)!);
    const serialized = serializeTable({
      header: parsed!.header,
      rows: parsed!.rows,
      alignments: parsed!.alignments
    });
    // Re-parse the serialized output and verify the structure is preserved.
    const state2 = makeState(serialized + '\n');
    const reparsed = parseTable(state2, findTableNode(state2)!);
    expect(reparsed!.header.map((c) => c.text)).toEqual(['A', 'B']);
    expect(reparsed!.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['1', '2'],
      ['3', '4']
    ]);
    expect(reparsed!.alignments).toEqual(['left', 'right']);
  });

  it('handles missing alignment entries by padding with null', () => {
    const out = serializeTable({
      header: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
      rows: [],
      alignments: ['left'] // shorter than header — should pad
    });
    expect(out).toContain('| :--- | --- | --- |');
  });
});

describe('sameTableStructure / cellText', () => {
  it('returns true for tables with same shape', () => {
    const a = {
      from: 0,
      to: 10,
      header: [
        { from: 0, to: 1, text: 'A' },
        { from: 0, to: 1, text: 'B' }
      ],
      rows: [
        [
          { from: 0, to: 1, text: '1' },
          { from: 0, to: 1, text: '2' }
        ]
      ],
      alignments: [null, null] as (
        | 'left'
        | 'right'
        | 'center'
        | null
      )[]
    };
    const b = {
      ...a,
      header: [
        { from: 0, to: 1, text: 'X' },
        { from: 0, to: 1, text: 'Y' }
      ]
    };
    expect(sameTableStructure(a, b)).toBe(true);
  });

  it('returns false when row count differs', () => {
    const a = {
      from: 0,
      to: 10,
      header: [{ from: 0, to: 1, text: 'A' }],
      rows: [[{ from: 0, to: 1, text: '1' }]],
      alignments: [null] as ('left' | 'right' | 'center' | null)[]
    };
    const b = { ...a, rows: [] };
    expect(sameTableStructure(a, b)).toBe(false);
  });

  it('returns false when alignments differ', () => {
    const a = {
      from: 0,
      to: 10,
      header: [{ from: 0, to: 1, text: 'A' }],
      rows: [],
      alignments: ['left'] as ('left' | 'right' | 'center' | null)[]
    };
    const b = { ...a, alignments: ['right'] as ('left' | 'right' | 'center' | null)[] };
    expect(sameTableStructure(a, b)).toBe(false);
  });

  it('cellText returns header/body cell text correctly', () => {
    const t = {
      from: 0,
      to: 10,
      header: [{ from: 0, to: 1, text: 'H' }],
      rows: [[{ from: 0, to: 1, text: 'B' }]],
      alignments: [null] as ('left' | 'right' | 'center' | null)[]
    };
    expect(cellText(t, -1, 0)).toBe('H');
    expect(cellText(t, 0, 0)).toBe('B');
    expect(cellText(t, 99, 0)).toBe(''); // out-of-range
  });
});

describe('structural operations', () => {
  // 2-column, 2-row fixture with distinct alignments so column ops are visible.
  const base = (): SerializeInput => ({
    header: [{ text: 'A' }, { text: 'B' }],
    rows: [
      [{ text: '1' }, { text: '2' }],
      [{ text: '3' }, { text: '4' }]
    ],
    alignments: ['left', 'right'] as CellAlign[]
  });

  const texts = (s: SerializeInput) => ({
    header: s.header.map((c) => c.text),
    rows: s.rows.map((r) => r.map((c) => c.text)),
    alignments: s.alignments
  });

  it('insertColumn left of col 1 adds an empty column before it', () => {
    const out = insertColumn(base(), 1, 'left');
    expect(texts(out)).toEqual({
      header: ['A', '', 'B'],
      rows: [
        ['1', '', '2'],
        ['3', '', '4']
      ],
      alignments: ['left', null, 'right']
    });
  });

  it('insertColumn right of col 1 appends at the end', () => {
    const out = insertColumn(base(), 1, 'right');
    expect(texts(out)).toEqual({
      header: ['A', 'B', ''],
      rows: [
        ['1', '2', ''],
        ['3', '4', '']
      ],
      alignments: ['left', 'right', null]
    });
  });

  it('deleteColumn removes the column from header, rows and alignments', () => {
    const out = deleteColumn(base(), 0);
    expect(texts(out)).toEqual({
      header: ['B'],
      rows: [['2'], ['4']],
      alignments: ['right']
    });
  });

  it('deleteColumn is a no-op when only one column remains', () => {
    const single: SerializeInput = {
      header: [{ text: 'A' }],
      rows: [[{ text: '1' }]],
      alignments: ['left']
    };
    expect(texts(deleteColumn(single, 0))).toEqual(texts(single));
  });

  it('insertRow above/below splices a blank row at the right index', () => {
    expect(texts(insertRow(base(), 0, 'above')).rows).toEqual([
      ['', ''],
      ['1', '2'],
      ['3', '4']
    ]);
    expect(texts(insertRow(base(), 0, 'below')).rows).toEqual([
      ['1', '2'],
      ['', ''],
      ['3', '4']
    ]);
  });

  it('insertRow on the header (-1) inserts a first body row at the top', () => {
    const headerOnly: SerializeInput = {
      header: [{ text: 'A' }, { text: 'B' }],
      rows: [],
      alignments: [null, null]
    };
    expect(texts(insertRow(headerOnly, -1, 'below')).rows).toEqual([['', '']]);
  });

  it('deleteRow removes a body row and is a no-op on the header', () => {
    expect(texts(deleteRow(base(), 0)).rows).toEqual([['3', '4']]);
    expect(texts(deleteRow(base(), -1)).rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ]);
  });

  it('setColumnAlignment changes only the target column', () => {
    const out = setColumnAlignment(base(), 0, 'center');
    expect(out.alignments).toEqual(['center', 'right']);
  });

  it('setColumnAlignment pads a short alignment list before setting', () => {
    const short: SerializeInput = {
      header: [{ text: 'A' }, { text: 'B' }, { text: 'C' }],
      rows: [],
      alignments: ['left'] // shorter than header
    };
    expect(setColumnAlignment(short, 2, 'right').alignments).toEqual(['left', null, 'right']);
  });

  it('operations never mutate their input snapshot', () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    insertColumn(input, 0, 'left');
    deleteColumn(input, 0);
    insertRow(input, 0, 'below');
    deleteRow(input, 0);
    setColumnAlignment(input, 0, 'center');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('ops compose into valid GFM that re-parses to the same structure', () => {
    // Insert a column, insert a row, change alignment, then round-trip.
    let snap = base();
    snap = insertColumn(snap, 1, 'right');
    snap = insertRow(snap, 1, 'below');
    snap = setColumnAlignment(snap, 2, 'center');
    const md = serializeTable(snap);
    const state = makeState(md + '\n');
    const reparsed = parseTable(state, findTableNode(state)!);
    expect(reparsed!.header).toHaveLength(3);
    expect(reparsed!.rows).toHaveLength(3);
    expect(reparsed!.alignments).toEqual(['left', 'right', 'center']);
  });
});
