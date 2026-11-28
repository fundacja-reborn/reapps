// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { foldedRanges } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  foldAllHeadings,
  foldHeadingAtCursor,
  foldOnLine,
  foldedHeadingLines,
  hasFoldedSections,
  headingFold,
  headingFoldRange,
  syncHeadingFolds,
  toggleHeadingFoldAt,
  unfoldAllHeadings,
  unfoldHeadingAtCursor
} from './heading-fold';

const DOC = [
  '# Title', //            0
  'intro', //              1
  '', //                   2
  '## First', //           3
  'first body', //         4
  '',
  '### Detail', //         6
  'detail body', //        7
  '',
  '## Second', //          9
  'second body', //       10
  '',
  '## Empty', //          12
  '',
  'Underlined', //        14
  '----------', //        15
  'under body', //        16
  '',
  'plain paragraph', //   18
  'second line' //        19
].join('\n');

const labels = () => ({ fold: 'Collapse section', unfold: 'Expand section' });

describe('headingFold', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function open(doc = DOC, onFoldedChange?: (anyFolded: boolean) => void): EditorView {
    view = new EditorView({
      doc,
      extensions: [markdown({ base: markdownLanguage }), headingFold({ labels, onFoldedChange })],
      parent: document.body
    });
    return view;
  }

  const lineOf = (v: EditorView, n: number) => v.state.doc.line(n + 1);
  const range = (v: EditorView, n: number) =>
    headingFoldRange(v.state, lineOf(v, n).from, lineOf(v, n).to);
  const folds = (v: EditorView) => {
    const out: [number, string][] = [];
    foldedRanges(v.state).between(0, v.state.doc.length, (from, to) => {
      out.push([from, v.state.doc.lineAt(from).text + ' > ' + v.state.doc.lineAt(to).text]);
    });
    return out.sort((a, b) => a[0] - b[0]).map(([, text]) => text);
  };

  describe('what a heading folds', () => {
    it('hides up to the next heading of the same or a higher level', () => {
      const v = open();
      const first = range(v, 3)!;
      expect(first.from).toBe(lineOf(v, 3).to);
      expect(first.to).toBe(lineOf(v, 7).to);
      expect(range(v, 6)!.to).toBe(lineOf(v, 7).to);
      expect(range(v, 9)!.to).toBe(lineOf(v, 10).to);
    });

    it('a level 1 heading takes the sections below it to the end of the note', () => {
      const v = open();
      expect(range(v, 0)!.to).toBe(v.state.doc.length);
    });

    it('offers nothing for a heading with no text under it', () => {
      const v = open('## Only heading');
      expect(range(v, 0)).toBeNull();
      expect(range(open('## A\n## B\ntext'), 0)).toBeNull();
    });

    it('folds an underlined heading from its first line', () => {
      const v = open();
      const under = range(v, 14)!;
      expect(under.from).toBe(lineOf(v, 14).to);
      expect(under.to).toBe(v.state.doc.length);
      expect(range(v, 15)).toBeNull();
    });

    it('never offers a paragraph, a quote or a code block', () => {
      const v = open('para one\npara two\n\n> quote\n> more\n\n```\ncode\nmore\n```\n');
      for (let n = 0; n < v.state.doc.lines; n++) expect(range(v, n)).toBeNull();
    });
  });

  describe('buttons', () => {
    it('puts one on every heading that has a section, with its state', () => {
      const v = open();
      const buttons = [...v.dom.querySelectorAll<HTMLElement>('.cm-hfold-toggle')];
      // Title, First, Detail, Second, Underlined. "Empty" has none: the next
      // block is the underlined heading, which is level 2 as well.
      expect(buttons.length).toBe(5);
      expect(buttons.every((b) => b.getAttribute('aria-expanded') === 'true')).toBe(true);
      expect(buttons[0].getAttribute('aria-label')).toBe('Collapse section');
      expect(buttons[0].closest('.cm-line')!.classList.contains('cm-hfold-line')).toBe(true);
    });

    it('a click folds the section and shows the mark; a second one opens it', () => {
      const v = open();
      const button = () => v.dom.querySelectorAll<HTMLElement>('.cm-hfold-toggle')[1];
      button().click();
      expect(folds(v)).toEqual(['## First > detail body']);
      expect(button().getAttribute('aria-expanded')).toBe('false');
      expect(button().getAttribute('aria-label')).toBe('Expand section');
      const mark = v.dom.querySelector<HTMLElement>('.cm-hfold-placeholder')!;
      expect(mark.getAttribute('aria-label')).toBe('Expand section');
      expect(v.dom.textContent).not.toContain('first body');
      button().click();
      expect(folds(v)).toEqual([]);
      expect(v.dom.textContent).toContain('first body');
    });

    it('a click on the mark opens the section', () => {
      const v = open();
      toggleHeadingFoldAt(v, lineOf(v, 9).from);
      v.dom.querySelector<HTMLElement>('.cm-hfold-placeholder')!.click();
      expect(folds(v)).toEqual([]);
    });

    it('none on a paragraph while a lone dash is typed under it', () => {
      // `Foo\nBar\n-` is an underlined H2 by CommonMark, but with the caret on
      // the dash the user is starting a list item (`- item`), not a heading.
      const v = open('Foo\nBar\n-\n\nbody');
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 2).to) });
      expect(v.dom.querySelectorAll('.cm-hfold-toggle').length).toBe(0);
      // Caret elsewhere: the lone dash is an underline, as in the preview.
      v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) });
      expect(v.dom.querySelectorAll('.cm-hfold-toggle').length).toBe(1);
    });

    it('marks the heading line the caret is on', () => {
      const v = open();
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 9).from + 3) });
      const active = v.dom.querySelectorAll('.cm-hfold-active');
      expect(active.length).toBe(1);
      expect(active[0].textContent).toContain('Second');
    });

    it('turns the folded chevron the other way in a right-to-left heading', () => {
      const arabic = String.fromCodePoint(0x639, 0x646, 0x648, 0x627, 0x646);
      const v = open(`## ${arabic}\ntext\n\n## Latin\ntext`);
      foldAllHeadings(v);
      const buttons = [...v.dom.querySelectorAll<HTMLElement>('.cm-hfold-toggle')];
      expect(buttons.map((b) => b.classList.contains('cm-hfold-rtl'))).toEqual([true, false]);
    });

    it('does not change the note', () => {
      const v = open();
      foldAllHeadings(v);
      unfoldAllHeadings(v);
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      expect(v.state.doc.toString()).toBe(DOC);
    });
  });

  describe('commands', () => {
    it('fold all folds nested sections too, unfold all opens everything', () => {
      const v = open();
      expect(foldAllHeadings(v)).toBe(true);
      // "# Title" wraps every other heading, so it stays open (see below).
      expect(folds(v)).toEqual([
        '## First > detail body',
        '### Detail > detail body',
        '## Second > second body',
        'Underlined > second line'
      ]);
      expect(hasFoldedSections(v.state)).toBe(true);
      expect(foldAllHeadings(v)).toBe(false);
      expect(unfoldAllHeadings(v)).toBe(true);
      expect(hasFoldedSections(v.state)).toBe(false);
      expect(unfoldAllHeadings(v)).toBe(false);
    });

    it('fold all keeps a single top heading open, but folds several', () => {
      const several = open('# One\ntext\n\n## Sub\ntext\n\n# Two\ntext');
      foldAllHeadings(several);
      expect(folds(several)).toEqual(['# One > text', '## Sub > text', '# Two > text']);
      several.destroy();
      const alone = open('## Only\ntext\nmore');
      foldAllHeadings(alone);
      expect(folds(alone)).toEqual(['## Only > more']);
    });

    it('opening an outer section leaves the inner ones folded', () => {
      const v = open();
      foldAllHeadings(v);
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      expect(folds(v)).not.toContain('## First > detail body');
      expect(folds(v)).toContain('### Detail > detail body');
    });

    it('moves the caret out of text that gets hidden', () => {
      const v = open();
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 7).from + 2) });
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      expect(v.state.selection.main.head).toBe(lineOf(v, 3).to);
      expect(folds(v)).toEqual(['## First > detail body']);
    });

    it('fold at the caret takes the nearest heading above', () => {
      const v = open();
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 7).from + 2) });
      expect(foldHeadingAtCursor(v)).toBe(true);
      expect(folds(v)).toEqual(['### Detail > detail body']);
      // The caret is now on the "Detail" heading: unfold opens it again.
      expect(unfoldHeadingAtCursor(v)).toBe(true);
      expect(folds(v)).toEqual([]);
    });

    it('fold at the caret works from a blank line inside a section', () => {
      const v = open();
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 11).from) });
      expect(foldHeadingAtCursor(v)).toBe(true);
      expect(folds(v)).toEqual(['## Second > second body']);
    });

    it('does nothing above the first heading', () => {
      const v = open('plain\n\n# Later\ntext');
      v.dispatch({ selection: EditorSelection.cursor(2) });
      expect(foldHeadingAtCursor(v)).toBe(false);
      expect(unfoldHeadingAtCursor(v)).toBe(false);
    });
  });

  describe('edits next to hidden text', () => {
    function folded(n: number): EditorView {
      const v = open();
      toggleHeadingFoldAt(v, lineOf(v, n).from);
      return v;
    }

    it('editing the heading text keeps the fold', () => {
      const v = folded(9);
      v.dispatch({ changes: { from: lineOf(v, 9).to, insert: '!' } });
      expect(folds(v)).toEqual(['## Second! > second body']);
      v.dispatch({ changes: { from: lineOf(v, 9).from + 3, insert: 'X' } });
      expect(folds(v).length).toBe(1);
    });

    it('a line break at the end of the heading opens the section', () => {
      const v = folded(9);
      v.dispatch({ changes: { from: lineOf(v, 9).to, insert: '\n' } });
      expect(folds(v)).toEqual([]);
    });

    it('typing after the mark opens the section', () => {
      const v = folded(9);
      v.dispatch({ changes: { from: lineOf(v, 10).to, insert: 'x' } });
      expect(folds(v)).toEqual([]);
      expect(v.state.doc.line(11).text).toBe('second bodyx');
    });

    it('a change inside the hidden text opens the section', () => {
      const v = folded(3);
      v.dispatch({ changes: { from: lineOf(v, 4).from, to: lineOf(v, 4).from + 5, insert: 'FIRST' } });
      expect(folds(v)).toEqual([]);
    });

    it('a change elsewhere keeps the fold in place', () => {
      const v = folded(9);
      v.dispatch({ changes: { from: 0, insert: 'new first line\n' } });
      expect(folds(v)).toEqual(['## Second > second body']);
    });

    it('replacing the whole note drops the folds', () => {
      const v = folded(3);
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '# Other\ntext' } });
      expect(folds(v)).toEqual([]);
    });

    it('moving the caret into hidden text opens the section', () => {
      const v = folded(3);
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 4).from + 2) });
      expect(folds(v)).toEqual([]);
    });

    it('a fold whose line stopped being a heading keeps its button', () => {
      const v = folded(9);
      v.dispatch({ changes: { from: lineOf(v, 9).from, to: lineOf(v, 9).from + 3, insert: '' } });
      expect(folds(v).length).toBe(1);
      const line = lineOf(v, 9);
      expect(foldOnLine(v.state, line.from, line.to)).not.toBeNull();
      const buttons = [...v.dom.querySelectorAll<HTMLElement>('.cm-hfold-folded')];
      expect(buttons.length).toBe(1);
      buttons[0].click();
      expect(folds(v)).toEqual([]);
    });
  });

  it('reports when the note starts and stops having folded sections', () => {
    const onFoldedChange = vi.fn();
    const v = open(DOC, onFoldedChange);
    toggleHeadingFoldAt(v, lineOf(v, 3).from);
    toggleHeadingFoldAt(v, lineOf(v, 9).from);
    expect(onFoldedChange.mock.calls).toEqual([[true]]);
    unfoldAllHeadings(v);
    expect(onFoldedChange.mock.calls).toEqual([[true], [false]]);
  });

  describe('folds shared with the preview', () => {
    function openShared(onFoldedLinesChange: (lines: number[]) => void): EditorView {
      view = new EditorView({
        doc: DOC,
        extensions: [
          markdown({ base: markdownLanguage }),
          headingFold({ labels, onFoldedLinesChange })
        ],
        parent: document.body
      });
      return view;
    }

    it('lists the folded heading lines in document order', () => {
      const v = open();
      expect(foldedHeadingLines(v.state)).toEqual([]);
      toggleHeadingFoldAt(v, lineOf(v, 9).from);
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      expect(foldedHeadingLines(v.state)).toEqual([4, 10]);
    });

    it('reports the lines on a fold and an unfold, not on other transactions', () => {
      const onLines = vi.fn();
      const v = openShared(onLines);
      v.dispatch({ selection: EditorSelection.cursor(2) });
      v.dispatch({ changes: { from: 0, insert: 'x' } });
      expect(onLines).not.toHaveBeenCalled();
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      expect(onLines.mock.calls).toEqual([[[4]]]);
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      expect(onLines.mock.calls).toEqual([[[4]], [[]]]);
    });

    it('reports again when an edit moves a folded heading', () => {
      const onLines = vi.fn();
      const v = openShared(onLines);
      toggleHeadingFoldAt(v, lineOf(v, 9).from);
      v.dispatch({ changes: { from: 0, insert: 'new first line\n' } });
      expect(onLines.mock.calls).toEqual([[[10]], [[11]]]);
    });

    it('reports an empty list when the whole note is replaced', () => {
      const onLines = vi.fn();
      const v = openShared(onLines);
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '# Other\ntext' } });
      expect(onLines.mock.calls.at(-1)).toEqual([[]]);
    });

    it('syncHeadingFolds folds and opens the listed lines only', () => {
      const v = open();
      toggleHeadingFoldAt(v, lineOf(v, 9).from); // ## Second
      toggleHeadingFoldAt(v, lineOf(v, 14).from); // underlined, not listed below
      expect(
        syncHeadingFolds(
          v,
          new Map([
            [4, true], // ## First: fold
            [10, false], // ## Second: open
            [7, false] // ### Detail: already open
          ])
        )
      ).toBe(true);
      expect(folds(v)).toEqual(['## First > detail body', 'Underlined > second line']);
    });

    it('syncHeadingFolds does nothing when the editor is already there', () => {
      const v = open();
      toggleHeadingFoldAt(v, lineOf(v, 3).from);
      const before = v.state;
      expect(
        syncHeadingFolds(
          v,
          new Map([
            [4, true],
            [10, false],
            [13, true], // ## Empty: nothing to fold
            [2, true], // not a heading
            [99, true] // past the end
          ])
        )
      ).toBe(false);
      expect(v.state).toBe(before);
    });

    it('syncHeadingFolds moves the caret out of text it hides', () => {
      const v = open();
      v.dispatch({ selection: EditorSelection.cursor(lineOf(v, 4).from + 2) });
      syncHeadingFolds(v, new Map([[4, true]]));
      expect(folds(v)).toEqual(['## First > detail body']);
      expect(v.state.selection.main.head).toBe(lineOf(v, 3).to);
    });
  });
});
