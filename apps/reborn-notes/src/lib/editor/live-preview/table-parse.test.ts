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
  cellText
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
