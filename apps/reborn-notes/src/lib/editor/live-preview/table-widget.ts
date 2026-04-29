/**
 * Editable table widget for Live Preview.
 *
 * Renders a GFM table as a real <table> with `contenteditable` cells. Always
 * shown — even when the cursor is "inside" the markdown source — so the user
 * never sees raw `| ... |` syntax (Obsidian-style behaviour). Edits in cells
 * are serialized back to GFM markdown and dispatched as a single change to the
 * underlying CM6 doc, keeping the source as the canonical state.
 *
 * Focus retention is the central trick. When the user types in a cell, the
 * dispatched change re-runs `buildDecorations`, producing a new `TableWidget`.
 * `eq()` returns true for structurally identical tables (same columns / rows /
 * alignments), so CM6 calls `updateDOM` on the existing root rather than
 * rebuilding it. `updateDOM` skips any cell that currently holds DOM focus,
 * preserving caret position seamlessly.
 *
 * Structural changes (new row added) intentionally fail `eq()`, forcing a full
 * `toDOM` rebuild. The handler that triggered the structural change manually
 * re-focuses the appropriate cell after the rebuild.
 */
import type { EditorView } from '@codemirror/view';
import { WidgetType } from '@codemirror/view';
import { Annotation } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  type ParsedTable,
  type CellAlign,
  sameTableStructure,
  serializeTable
} from './table-parse';

/** Annotation marking a transaction as a cell-level table edit. Reserved for
 *  potential future use (e.g. suppressing analytics or scroll-sync); not
 *  load-bearing for the edit pipeline itself. */
export const tableCellEditAnnotation = Annotation.define<true>();

/**
 * Look up the current `Table` node containing the widget's DOM root. We do
 * not store doc positions on the widget — they would go stale across
 * incremental parses. `posAtDOM` plus a syntax-tree walk gives us the
 * current authoritative position.
 */
function findTableRange(view: EditorView, tableEl: HTMLElement): { from: number; to: number } | null {
  const pos = view.posAtDOM(tableEl);
  if (pos < 0) return null;
  const tree = syntaxTree(view.state);
  let node: SyntaxNode | null = tree.resolveInner(pos, 1);
  while (node && node.type.name !== 'Table') node = node.parent;
  if (!node) return null;
  return { from: node.from, to: node.to };
}

interface CellAddress {
  /** -1 for header row, >=0 for body rows. */
  row: number;
  col: number;
}

function alignStyle(a: CellAlign): string {
  switch (a) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'center':
      return 'center';
    default:
      return '';
  }
}

/**
 * Read cell text from the live DOM, mapping `<br>` elements to literal `\n`
 * (Shift+Enter line breaks). Walks the DOM tree directly — `textContent`
 * silently drops `<br>` separators, and `innerText` triggers a layout reflow.
 *
 * Also normalizes U+00A0 (non-breaking space) → ASCII space; browsers insert
 * NBSP inside contenteditable when preserving repeated-space layout.
 */
function readCellText(el: Element): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof HTMLBRElement) {
      out += '\n';
    } else if (node instanceof Element) {
      out += readCellText(node);
      // Block-level children get an implicit newline (Firefox sometimes wraps
      // pasted/typed lines in <div>).
      const tag = node.tagName;
      if (tag === 'DIV' || tag === 'P') out += '\n';
    }
  });
  return out
    .replace(/\u00A0/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/g, '')
    .replace(/^\n+|\n+$/g, '');
}

/** Snapshot the current text of every cell from the live DOM tree. */
function readDomTable(
  root: HTMLElement,
  cols: number
): { header: { text: string }[]; rows: { text: string }[][] } {
  const header: { text: string }[] = [];
  const headerRow = root.querySelector('thead > tr');
  if (headerRow) {
    headerRow.querySelectorAll('th').forEach((th) => {
      header.push({ text: readCellText(th) });
    });
  }
  // Pad if DOM has fewer header cells than expected (defensive).
  while (header.length < cols) header.push({ text: '' });

  const rows: { text: string }[][] = [];
  root.querySelectorAll('tbody > tr').forEach((tr) => {
    const row: { text: string }[] = [];
    tr.querySelectorAll('td').forEach((td) => {
      row.push({ text: readCellText(td) });
    });
    while (row.length < cols) row.push({ text: '' });
    rows.push(row);
  });
  return { header, rows };
}

/**
 * Replace cell DOM content with text that may contain `\n` line breaks.
 * Inserts text nodes interleaved with `<br>` elements. Used by both `toDOM`
 * (initial render) and `updateDOM` (when target text differs).
 */
function setCellContent(cell: HTMLElement, text: string): void {
  cell.replaceChildren();
  if (text.length === 0) return;
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (part.length > 0) cell.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) cell.appendChild(document.createElement('br'));
  });
}

/**
 * Insert a `<br>` at the current selection inside `cell`, then place the
 * caret immediately after it. Handles two layout edge cases:
 *  - empty trailing line: append a second `<br>` so the caret has a render
 *    target (without it, browsers won't paint the new blank line until the
 *    next character is typed);
 *  - selection collapsed at end of cell: same fix, since the caret would
 *    otherwise jump out of the cell on the next keypress.
 */
function insertLineBreakAtSelection(cell: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!cell.contains(range.commonAncestorContainer)) return;

  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);

  // If the line break is the last child (or only followed by another <br>
  // that's already a placeholder), add a trailing <br> so the new line is
  // visible. Otherwise the caret would sit on a non-painted phantom line.
  const next = br.nextSibling;
  const needsTrailingBr =
    next === null ||
    (next instanceof HTMLBRElement && next === cell.lastChild);
  if (needsTrailingBr) {
    cell.insertBefore(document.createElement('br'), br.nextSibling);
  }

  // Move caret to immediately after the inserted <br>.
  const newRange = document.createRange();
  newRange.setStartAfter(br);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/**
 * True if `cell`'s current DOM exactly represents `text` (text nodes + `<br>`
 * for `\n`). Used by `updateDOM` to skip touching cells that haven't changed
 * — `setCellContent` would otherwise rebuild children and wipe the caret on
 * every keystroke in the active cell.
 */
function cellMatchesText(cell: HTMLElement, text: string): boolean {
  let i = 0;
  for (const node of Array.from(cell.childNodes)) {
    if (node instanceof HTMLBRElement) {
      if (text[i] !== '\n') return false;
      i += 1;
    } else if (node.nodeType === Node.TEXT_NODE) {
      const part = node.textContent ?? '';
      if (text.slice(i, i + part.length) !== part) return false;
      i += part.length;
    } else {
      return false;
    }
  }
  return i === text.length;
}

/** Locate a cell DOM node for `(row, col)` — `row === -1` is the header. */
function cellAt(root: HTMLElement, row: number, col: number): HTMLElement | null {
  if (row === -1) {
    const ths = root.querySelectorAll<HTMLElement>('thead > tr > th');
    return ths[col] ?? null;
  }
  const trs = root.querySelectorAll<HTMLElement>('tbody > tr');
  const tr = trs[row];
  if (!tr) return null;
  return tr.querySelectorAll<HTMLElement>('td')[col] ?? null;
}

/** Move browser focus to a cell, placing the caret at the end of its text. */
function focusCell(root: HTMLElement, row: number, col: number): void {
  const el = cellAt(root, row, col);
  if (!el) return;
  el.focus();
  // Place caret at end of cell content.
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export class TableWidget extends WidgetType {
  /** Tracks IME composition per widget instance to suppress dispatches mid-compose. */
  private composing = false;
  /** Current view, captured by `toDOM` / `updateDOM`. CM6 always passes the
   *  active view into both methods, so listeners can rely on this being
   *  fresh for the lifetime of the DOM root. */
  private view: EditorView | null = null;

  constructor(public readonly table: ParsedTable) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof TableWidget)) return false;
    return sameTableStructure(this.table, other.table);
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const root = document.createElement('div');
    root.className = 'cm-lp-table-wrap';
    // Block stray browser selection from spanning into other live-preview
    // content while the user clicks around inside cells.
    root.spellcheck = false;

    const tableEl = document.createElement('table');
    tableEl.className = 'cm-lp-table';

    const thead = document.createElement('thead');
    const headerTr = document.createElement('tr');
    this.table.header.forEach((cell, col) => {
      const th = document.createElement('th');
      th.className = 'cm-lp-table-header';
      th.contentEditable = 'true';
      th.spellcheck = false;
      th.dataset.row = '-1';
      th.dataset.col = String(col);
      const align = alignStyle(this.table.alignments[col]);
      if (align) th.style.textAlign = align;
      setCellContent(th, cell.text);
      this.attachCellListeners(th, { row: -1, col });
      headerTr.appendChild(th);
    });
    thead.appendChild(headerTr);
    tableEl.appendChild(thead);

    const tbody = document.createElement('tbody');
    this.table.rows.forEach((row, rowIdx) => {
      const tr = document.createElement('tr');
      row.forEach((cell, col) => {
        const td = document.createElement('td');
        td.className = 'cm-lp-table-cell';
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.dataset.row = String(rowIdx);
        td.dataset.col = String(col);
        const align = alignStyle(this.table.alignments[col]);
        if (align) td.style.textAlign = align;
        setCellContent(td, cell.text);
        this.attachCellListeners(td, { row: rowIdx, col });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);

    root.appendChild(tableEl);
    return root;
  }

  /**
   * Update cell text without rebuilding the DOM tree, preserving focus and
   * caret in any cell the user is currently editing. Returns true if the
   * existing root can host the new state — if structure changed (unlikely
   * because `eq()` already filtered) we bail out and let CM6 rebuild.
   */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.view = view;
    if (!dom.classList.contains('cm-lp-table-wrap')) return false;
    const tableEl = dom.querySelector<HTMLElement>('table.cm-lp-table');
    if (!tableEl) return false;

    const cols = this.table.header.length;
    const headerCells = tableEl.querySelectorAll<HTMLElement>('thead > tr > th');
    if (headerCells.length !== cols) return false;
    const bodyRows = tableEl.querySelectorAll<HTMLElement>('tbody > tr');
    if (bodyRows.length !== this.table.rows.length) return false;

    const active = document.activeElement;

    headerCells.forEach((th, col) => {
      const target = this.table.header[col]?.text ?? '';
      const align = alignStyle(this.table.alignments[col]);
      th.style.textAlign = align;
      if (th !== active && !cellMatchesText(th, target)) setCellContent(th, target);
    });

    bodyRows.forEach((tr, rowIdx) => {
      const cells = tr.querySelectorAll<HTMLElement>('td');
      if (cells.length !== cols) return;
      cells.forEach((td, col) => {
        const target = this.table.rows[rowIdx]?.[col]?.text ?? '';
        const align = alignStyle(this.table.alignments[col]);
        td.style.textAlign = align;
        if (td !== active && !cellMatchesText(td, target)) setCellContent(td, target);
      });
    });

    return true;
  }

  /** Block CM6 from interpreting clicks/keys inside cells as editor input. */
  ignoreEvent(): boolean {
    return true;
  }

  // ─── Event wiring ───────────────────────────────────────────────

  private attachCellListeners(cell: HTMLElement, addr: CellAddress): void {
    cell.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    cell.addEventListener('compositionend', () => {
      this.composing = false;
      this.dispatchFromDom(cell);
    });

    cell.addEventListener('input', () => {
      if (this.composing) return;
      this.dispatchFromDom(cell);
    });

    cell.addEventListener('keydown', (e) => {
      this.handleKeydown(e, cell, addr);
    });

    // Block paste with newlines from breaking table syntax. Strip to plain
    // text and collapse newlines to a single space — literal pipes flow
    // through and get escaped at serialization time (`escapeCell`).
    cell.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text === undefined || text === null) return;
      e.preventDefault();
      const cleaned = text.replace(/\r?\n/g, ' ');
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(cleaned));
      range.collapse(false);
      this.dispatchFromDom(cell);
    });
  }

  private handleKeydown(
    e: KeyboardEvent,
    cell: HTMLElement,
    addr: CellAddress
  ): void {
    const root = this.getRoot(cell);
    if (!root) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      this.moveFocus(root, addr, e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        // Insert a soft line break inside the cell. Browser default for
        // Shift+Enter in contenteditable varies (some insert <br>, some <div>) —
        // we own the insertion to keep DOM shape predictable.
        insertLineBreakAtSelection(cell);
        this.dispatchFromDom(cell);
      } else {
        this.moveToNextRow(root, addr);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      const view = this.view;
      if (!view) return;
      const range = findTableRange(view, root.querySelector('table.cm-lp-table') as HTMLElement);
      if (range) {
        view.dispatch({ selection: { anchor: range.to } });
      }
      view.focus();
      return;
    }
  }

  /** Direction: +1 next, -1 previous. Tab past the last cell adds a row. */
  private moveFocus(root: HTMLElement, addr: CellAddress, dir: 1 | -1): void {
    const cols = this.table.header.length;
    const rows = this.table.rows.length;
    let r = addr.row;
    let c = addr.col + dir;

    if (dir === 1 && c >= cols) {
      c = 0;
      r += 1;
    } else if (dir === -1 && c < 0) {
      c = cols - 1;
      r -= 1;
    }

    if (dir === 1 && r > rows - 1) {
      // Past the last cell of the last body row → append a new row and focus
      // the first cell. r === -1 (header) followed by no body rows hits this
      // path too, which is the correct behaviour.
      this.addRowAndFocus(root, rows);
      return;
    }
    if (dir === -1 && r < -1) return; // Already at header start; do nothing.

    focusCell(root, r, c);
  }

  /** Enter: move down one row. If already on the last row, append a row. */
  private moveToNextRow(root: HTMLElement, addr: CellAddress): void {
    const rows = this.table.rows.length;
    const nextRow = addr.row + 1;
    if (nextRow > rows - 1) {
      this.addRowAndFocus(root, rows);
      return;
    }
    focusCell(root, nextRow, addr.col);
  }

  /** Append an empty body row and focus its first cell after the rebuild. */
  private addRowAndFocus(root: HTMLElement, newRowIdx: number): void {
    const view = this.view;
    if (!view) return;
    const tableEl = root.querySelector<HTMLElement>('table.cm-lp-table');
    if (!tableEl) return;
    const range = findTableRange(view, tableEl);
    if (!range) return;

    const cols = this.table.header.length;
    const dom = readDomTable(root, cols);
    dom.rows.push(Array.from({ length: cols }, () => ({ text: '' })));

    const newMd = serializeTable({
      header: dom.header,
      rows: dom.rows,
      alignments: this.table.alignments
    });

    view.dispatch({
      changes: { from: range.from, to: range.to, insert: newMd },
      annotations: tableCellEditAnnotation.of(true)
    });

    // After the dispatch CM6 will rebuild the widget (structure changed →
    // toDOM, not updateDOM). The new DOM root replaces ours, so we look it
    // up by position rather than reusing `root`.
    requestAnimationFrame(() => {
      const v = this.view;
      if (!v) return;
      // Find the table widget's DOM at the same logical position.
      const newPos = range.from;
      const newDom = v.domAtPos(newPos)?.node as Node | null;
      const newTable = (newDom instanceof HTMLElement
        ? newDom.querySelector<HTMLElement>('div.cm-lp-table-wrap')
        : null) ?? v.dom.querySelector<HTMLElement>('div.cm-lp-table-wrap');
      if (newTable) focusCell(newTable, newRowIdx, 0);
    });
  }

  /** Read the current state from DOM and dispatch a doc change. */
  private dispatchFromDom(cell: HTMLElement): void {
    const view = this.view;
    if (!view) return;
    const root = this.getRoot(cell);
    if (!root) return;
    const tableEl = root.querySelector<HTMLElement>('table.cm-lp-table');
    if (!tableEl) return;
    const range = findTableRange(view, tableEl);
    if (!range) return;

    const cols = this.table.header.length;
    const dom = readDomTable(root, cols);
    const newMd = serializeTable({
      header: dom.header,
      rows: dom.rows,
      alignments: this.table.alignments
    });

    const currentMd = view.state.doc.sliceString(range.from, range.to);
    if (currentMd === newMd) return; // No-op (defensive — saves an empty tx).

    view.dispatch({
      changes: { from: range.from, to: range.to, insert: newMd },
      annotations: tableCellEditAnnotation.of(true)
    });
  }

  private getRoot(cell: HTMLElement): HTMLElement | null {
    return cell.closest<HTMLElement>('div.cm-lp-table-wrap');
  }
}
