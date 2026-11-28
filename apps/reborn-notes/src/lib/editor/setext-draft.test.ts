import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { isDraftSetextHeading } from './setext-draft';

function stateWith(doc: string, ...carets: number[]): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [Strikethrough, Table, TaskList] }),
      EditorState.allowMultipleSelections.of(true)
    ],
    selection: EditorSelection.create(carets.map((pos) => EditorSelection.cursor(pos)))
  });
}

function setextNode(state: EditorState): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (/^SetextHeading[12]$/.test(node.name)) found = node.node;
    }
  });
  return found;
}

/** Draft state of the doc's underlined heading, or null when it has none. */
function draft(doc: string, ...carets: number[]): boolean | null {
  const state = stateWith(doc, ...(carets.length ? carets : [doc.length]));
  const node = setextNode(state);
  return node ? isDraftSetextHeading(state, node) : null;
}

describe('isDraftSetextHeading', () => {
  it('a lone dash being typed under a paragraph is a draft', () => {
    expect(draft('Foo\nBar\n-')).toBe(true);
  });

  it('stays a draft after the space that starts a list item', () => {
    expect(draft('Foo\nBar\n- ')).toBe(true);
  });

  it('a lone `=` being typed is a draft too', () => {
    expect(draft('Foo\n=')).toBe(true);
  });

  it('counts the lone mark with indentation and trailing spaces', () => {
    expect(draft('Foo\n  -  ')).toBe(true);
  });

  it('inside a quote and a list item as well', () => {
    expect(draft('> Foo\n> -')).toBe(true);
    expect(draft('1. Foo\n   -')).toBe(true);
  });

  it('is a heading once the caret leaves the underline', () => {
    // Caret in "Foo".
    expect(draft('Foo\n-\n\nnext', 1)).toBe(false);
    // Caret further down.
    expect(draft('Foo\n-\n\nnext')).toBe(false);
  });

  it('any caret on the underline line counts (multiple selections)', () => {
    expect(draft('Foo\n-\n\nnext', 1, 5)).toBe(true);
  });

  it('an underline drawn on purpose stays a heading', () => {
    expect(draft('Foo\n--')).toBe(false);
    expect(draft('Foo\n---')).toBe(false);
    expect(draft('Foo\n===')).toBe(false);
  });

  it('a list item under a paragraph is not a heading at all', () => {
    expect(draft('Foo\n- t')).toBeNull();
  });

  it('ignores headings with a `#`', () => {
    const state = stateWith('## Foo', 3);
    const heading = syntaxTree(state).topNode.firstChild!;
    expect(heading.name).toBe('ATXHeading2');
    expect(isDraftSetextHeading(state, heading)).toBe(false);
  });
});
