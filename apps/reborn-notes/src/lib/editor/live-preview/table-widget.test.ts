// @vitest-environment jsdom
/**
 * End-to-end regression tests for the editable table widget, driving a real
 * `EditorView` + the live-preview field so the full edit pipeline runs
 * (contenteditable cell → serialize → dispatch → re-parse → re-render). These
 * guard four bugs reported against the structural mini-toolbar, all of which
 * stemmed from reading STALE state instead of the live document:
 *
 *  1. Pasting into the bottom-right cell duplicated the text into the cell to
 *     its left - `@lezer/markdown` drops empty cells, so the re-parse shifted
 *     content one column left (now fixed in `parseTableMarkdown`).
 *  2. Changing one column's alignment reset every other column to default - the
 *     toolbar handlers used a stale widget instance's `this.table.alignments`
 *     (now read fresh from the doc in `applyStructuralOp`).
 *  3. "Insert column left" and "insert column right" both inserted on the right
 *     (a downstream symptom of #1's column shift).
 *  4. Pressing Enter after pasting moved the text to the bottom-LEFT cell (also
 *     #1's shift, made permanent by the next serialize).
 *
 * jsdom does not focus a contenteditable element unless it is focusable, so the
 * helpers set `tabIndex` before `focus()` - this makes `document.activeElement`
 * track the cell exactly as a browser would, which is what the widget's
 * live-read path keys off.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import { createLivePreviewField } from './decorations';

const flush = () => new Promise((r) => setTimeout(r, 10));

function mountTable(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown({ extensions: [Strikethrough, Table, TaskList] }), createLivePreviewField()]
    })
  });
}

function outer(view: EditorView): HTMLElement {
  const el = view.dom.querySelector<HTMLElement>('.cm-lp-table-outer');
  if (!el) throw new Error('no editable table rendered');
  return el;
}
function cell(view: EditorView, row: number, col: number): HTMLElement {
  const o = outer(view);
  if (row === -1) return o.querySelectorAll<HTMLElement>('thead th')[col];
  return o.querySelectorAll<HTMLElement>('tbody tr')[row].querySelectorAll<HTMLElement>('td')[col];
}
function focusCell(view: EditorView, row: number, col: number): HTMLElement {
  const c = cell(view, row, col);
  c.tabIndex = 0;
  c.focus();
  return c;
}
/** Insert text at the caret like the widget's own paste handler does. */
function pasteInto(c: HTMLElement, text: string): void {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(c);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  c.dispatchEvent(new Event('input', { bubbles: true }));
}
/** Set the toolbar target (hover fallback) and click a toolbar button. */
function clickTool(view: EditorView, row: number, col: number, sel: string): void {
  const o = outer(view);
  focusCell(view, row, col);
  o.dataset.hr = String(row);
  o.dataset.hc = String(col);
  (o.querySelector(sel) as HTMLButtonElement | null)?.click();
}
const lines = (view: EditorView) => view.state.doc.toString().split('\n');
function bodyRowTexts(view: EditorView, row: number): string[] {
  return Array.from(cell(view, row, 0).closest('tr')!.querySelectorAll<HTMLElement>('td')).map(
    (td) => td.textContent ?? ''
  );
}

const DOC = [
  '| Col 1 | Col 2 | Col 3 |',
  '| --- | --- | --- |',
  '| Lorem | Suspendisse |   |',
  '| Nulla |   |   |'
].join('\n');

describe('TableWidget structural ops (regression)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('bug1: paste into bottom-right cell stays in that column', async () => {
    const view = mountTable(DOC);
    pasteInto(focusCell(view, 1, 2), 'PASTED');
    await flush();
    // Doc: text only in column 3.
    expect(lines(view)[3]).toBe('| Nulla |   | PASTED |');
    // Render: blur so the cell shows its rendered (not raw) form, then inspect.
    cell(view, 1, 2).blur();
    focusCell(view, 0, 0);
    await flush();
    expect(bodyRowTexts(view, 1)).toEqual(['Nulla', '', 'PASTED']);
    view.destroy();
  });

  it('bug2: setting one column alignment preserves the others', async () => {
    const view = mountTable(DOC);
    clickTool(view, -1, 0, '.cm-lp-table-align-right');
    await flush();
    expect(lines(view)[1]).toBe('| ---: | --- | --- |');
    clickTool(view, -1, 1, '.cm-lp-table-align-center');
    await flush();
    // col0 must KEEP right; col1 becomes center.
    expect(lines(view)[1]).toBe('| ---: | :---: | --- |');
    // A third change to col2 keeps the first two.
    clickTool(view, -1, 2, '.cm-lp-table-align-right');
    await flush();
    expect(lines(view)[1]).toBe('| ---: | :---: | ---: |');
    // Rendered alignment reflects the doc.
    const aligns = Array.from(outer(view).querySelectorAll<HTMLElement>('thead th')).map(
      (th) => th.style.textAlign || 'left'
    );
    expect(aligns).toEqual(['right', 'center', 'right']);
    view.destroy();
  });

  it('bug3: insert column left vs right land on opposite sides', async () => {
    const left = mountTable(DOC);
    clickTool(left, -1, 1, '.cm-lp-table-insert-col-left');
    await flush();
    // New empty column inserted BEFORE Col 2.
    expect(lines(left)[0]).toBe('| Col 1 |   | Col 2 | Col 3 |');
    left.destroy();

    const right = mountTable(DOC);
    clickTool(right, -1, 1, '.cm-lp-table-insert-col-right');
    await flush();
    // New empty column inserted AFTER Col 2.
    expect(lines(right)[0]).toBe('| Col 1 | Col 2 |   | Col 3 |');
    right.destroy();
  });

  it('bug4: Enter after pasting into bottom-right keeps the text and adds a row', async () => {
    const view = mountTable(DOC);
    pasteInto(focusCell(view, 1, 2), 'PASTED');
    await flush();
    focusCell(view, 1, 2).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await flush();
    const out = lines(view);
    expect(out[3]).toBe('| Nulla |   | PASTED |'); // unchanged, text stays in col3
    expect(out[4]).toBe('|   |   |   |'); // new empty row appended
    view.destroy();
  });

  it('typing in a cell after an alignment change does not revert the alignment', async () => {
    const view = mountTable(DOC);
    clickTool(view, -1, 0, '.cm-lp-table-align-right');
    await flush();
    // Now type into a body cell; the dispatch must preserve col0=right.
    const c = focusCell(view, 0, 1);
    c.textContent = 'Suspendisse!';
    c.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(lines(view)[1]).toBe('| ---: | --- | --- |');
    view.destroy();
  });
});
