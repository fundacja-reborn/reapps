import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table } from '@lezer/markdown';
import { tryListIndent, tryListOutdent } from './list-keymap';

function makeState(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor, head: cursor },
    extensions: [markdown({ extensions: [Strikethrough, Table] })]
  });
}

function applyIndent(doc: string, cursor: number): string | null {
  const state = makeState(doc, cursor);
  const r = tryListIndent(state);
  if (r === null) return null;
  if (r === 'noop') return state.doc.toString();
  return state.update({ changes: r.changes }).state.doc.toString();
}

function applyOutdent(doc: string, cursor: number): string | null {
  const state = makeState(doc, cursor);
  const r = tryListOutdent(state);
  if (r === null) return null;
  return state.update({ changes: r.changes }).state.doc.toString();
}

describe('tryListIndent — ordered list', () => {
  it('indents `2. two` after `1. one` with 3 spaces and renumbers to `1.`', () => {
    expect(applyIndent('1. one\n2. two', '1. one\n2. two'.length)).toBe('1. one\n   1. two');
  });

  it('preserves multi-digit parent marker width (`10. ` → 4 spaces)', () => {
    const doc = '10. ten\n11. eleven';
    expect(applyIndent(doc, doc.length)).toBe('10. ten\n    1. eleven');
  });

  it('renumbers outer list when middle item is indented', () => {
    const doc = '1. one\n2. two\n3. three';
    expect(applyIndent(doc, '1. one\n2. two'.length)).toBe('1. one\n   1. two\n2. three');
  });

  it('renumber preserves outer-list start when first marker is not 1', () => {
    const doc = '9. nine\n10. ten\n11. eleven';
    expect(applyIndent(doc, '9. nine\n10. ten'.length)).toBe(
      '9. nine\n   1. ten\n10. eleven'
    );
  });

  it('returns noop on first item of list (no doc change, command consumed)', () => {
    const doc = '1. one\n2. two';
    expect(applyIndent(doc, 0)).toBe(doc);
  });

  it('handles `2)` punctuation (CommonMark variant)', () => {
    const doc = '1) one\n2) two';
    expect(applyIndent(doc, doc.length)).toBe('1) one\n   1) two');
  });
});

describe('tryListIndent — bullet list', () => {
  it('indents `- two` after `- one` with 2 spaces (no renumber)', () => {
    const doc = '- one\n- two';
    expect(applyIndent(doc, doc.length)).toBe('- one\n  - two');
  });

  it('preserves bullet char on indent (`+` stays `+`)', () => {
    const doc = '+ one\n+ two';
    expect(applyIndent(doc, doc.length)).toBe('+ one\n  + two');
  });

  it('preserves bullet char on indent (`*` stays `*`)', () => {
    const doc = '* one\n* two';
    expect(applyIndent(doc, doc.length)).toBe('* one\n  * two');
  });
});

describe('tryListOutdent — ordered list', () => {
  it('outdents nested item back to outer list and renumbers', () => {
    const doc = '1. one\n   1. nested\n2. two';
    expect(applyOutdent(doc, '1. one\n   1. nested'.length)).toBe(
      '1. one\n2. nested\n3. two'
    );
  });

  it('returns null on already-top-level item (lets indentLess take over)', () => {
    const doc = '1. one\n2. two';
    expect(applyOutdent(doc, doc.length)).toBeNull();
  });

  it('returns null when item is not last in its sub-list (MVP guard)', () => {
    const doc = '1. one\n   1. a\n   2. b';
    expect(applyOutdent(doc, '1. one\n   1. a'.length)).toBeNull();
  });
});

describe('tryListOutdent — bullet list', () => {
  it('outdents nested bullet back to outer list', () => {
    const doc = '- one\n  - nested\n- two';
    expect(applyOutdent(doc, '- one\n  - nested'.length)).toBe(
      '- one\n- nested\n- two'
    );
  });
});

describe('tryListIndent / tryListOutdent — non-list contexts', () => {
  it('returns null on plain paragraph', () => {
    expect(applyIndent('plain text', 5)).toBeNull();
    expect(applyOutdent('plain text', 5)).toBeNull();
  });

  it('returns null on continuation line of a list item', () => {
    const doc = '1. first line\n   second line';
    expect(applyIndent(doc, doc.length)).toBeNull();
  });

  it('returns null for non-collapsed selection (MVP)', () => {
    const state = EditorState.create({
      doc: '1. one\n2. two',
      selection: { anchor: 0, head: 6 },
      extensions: [markdown({ extensions: [Strikethrough, Table] })]
    });
    expect(tryListIndent(state)).toBeNull();
    expect(tryListOutdent(state)).toBeNull();
  });
});

describe('tryListIndent — adjacent lists of different types', () => {
  it('bullet list following an ordered list — Tab on first bullet is noop', () => {
    const doc = '1. one\n- two';
    expect(applyIndent(doc, doc.length)).toBe(doc);
  });
});
