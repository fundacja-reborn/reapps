// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { createLivePreviewExtension, getMarkdownExtension } from './index';
import { HEADING_HIGHLIGHT_CLASSES } from './theme';

// The draft rule undoes the heading look through the highlighters' own class
// names. If NoteEditor.svelte wires another highlighter, or a highlighter starts
// naming heading text differently, the rule silently stops matching: the
// paragraph above a lone `-` flashes bold + underlined again. These tests pin
// the rule to the classes on the real rendered text.
describe('underline still being typed: highlighter classes', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function open(dark: boolean): EditorView {
    const doc = 'Foo\n-';
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        // The highlighters NoteEditor.svelte wires: default always, oneDark in dark mode.
        extensions: [
          getMarkdownExtension(),
          syntaxHighlighting(defaultHighlightStyle),
          dark ? oneDark : [],
          createLivePreviewExtension()
        ]
      }),
      parent: document.body
    });
    return view;
  }

  /** Highlighter classes on the text of the draft line holding `Foo`. */
  function headingClassesOnDraftText(v: EditorView): string[] {
    const line = v.dom.querySelector('.cm-line.cm-lp-setext-draft');
    expect(line?.textContent).toBe('Foo');
    const classes = new Set([...line!.querySelectorAll('*')].flatMap((el) => [...el.classList]));
    return HEADING_HIGHLIGHT_CLASSES.filter((cls) => classes.has(cls));
  }

  it('has one heading class per highlighter', () => {
    expect(HEADING_HIGHLIGHT_CLASSES).toHaveLength(2);
    expect(new Set(HEADING_HIGHLIGHT_CLASSES).size).toBe(2);
  });

  it('matches the class the light highlighter puts on the text', () => {
    expect(headingClassesOnDraftText(open(false))).toHaveLength(1);
  });

  it('matches the classes both highlighters put on it in dark mode', () => {
    expect(headingClassesOnDraftText(open(true))).toHaveLength(2);
  });
});
