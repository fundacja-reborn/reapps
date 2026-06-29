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
 *
 * Cell content has two presentations (Obsidian-style):
 *  - **rendered** when the cell is not focused — inline markdown (`**bold**`,
 *    `*em*`, `` `code` ``, `~~strike~~`, `[t](url)`) is shown formatted, built
 *    by `table-cell-render`;
 *  - **raw** when the cell is focused — the markdown source, so it can be
 *    edited character by character (identical to the old plain-text cell).
 * The swap happens on `focus`/`blur`. Because a rendered cell's visible text
 * drops the markdown markers, the canonical source for each rendered cell is
 * stashed on `dataset.lpSrc` and read back from there at serialization time —
 * never re-derived from the rendered DOM. Plain (unformatted) cells render
 * identically in both modes, so they skip the swap and keep native caret
 * placement on click.
 */
import type { EditorView } from '@codemirror/view';
import { WidgetType } from '@codemirror/view';
import { Annotation } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  type ParsedTable,
  type CellAlign,
  type SerializeInput,
  type ColumnSide,
  type RowSide,
  sameTableStructure,
  serializeTable,
  parseTableMarkdown,
  insertColumn,
  deleteColumn,
  insertRow,
  deleteRow,
  setColumnAlignment
} from './table-parse';
import { buildInlineFragment, cellHasFormatting } from './table-cell-render';
import { computeInlineWrap } from '../inline-wrap';

/** Annotation marking a transaction as a cell-level table edit. Reserved for
 *  potential future use (e.g. suppressing analytics or scroll-sync); not
 *  load-bearing for the edit pipeline itself. */
export const tableCellEditAnnotation = Annotation.define<true>();

/** i18n labels for the structural mini-toolbar (cannot read Svelte stores in a widget). */
export interface TableWidgetLabels {
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  insertColumnLeft: string;
  insertColumnRight: string;
  deleteColumn: string;
  insertRowAbove: string;
  insertRowBelow: string;
  deleteRow: string;
}

/** Compare two label sets field-by-field so a locale change re-renders the widget. */
function sameLabels(a: TableWidgetLabels, b: TableWidgetLabels): boolean {
  return (
    a.alignLeft === b.alignLeft &&
    a.alignCenter === b.alignCenter &&
    a.alignRight === b.alignRight &&
    a.insertColumnLeft === b.insertColumnLeft &&
    a.insertColumnRight === b.insertColumnRight &&
    a.deleteColumn === b.deleteColumn &&
    a.insertRowAbove === b.insertRowAbove &&
    a.insertRowBelow === b.insertRowBelow &&
    a.deleteRow === b.deleteRow
  );
}

// Toolbar glyphs — static, self-contained Lucide-style SVGs (16px,
// `stroke="currentColor"` so they follow the button colour). Never user input;
// inlined via `innerHTML` like the code-copy / TOC button icons.
const svg = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICON_ALIGN_LEFT = svg('<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>');
const ICON_ALIGN_CENTER = svg('<line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/>');
const ICON_ALIGN_RIGHT = svg('<line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="9" y1="12" y2="12"/><line x1="21" x2="7" y1="18" y2="18"/>');
const ICON_INSERT_COL_LEFT = svg('<path d="M3 19V5"/><path d="M21 12H7"/><path d="m11 18-6-6 6-6"/>');
const ICON_INSERT_COL_RIGHT = svg('<path d="M21 5v14"/><path d="M17 12H3"/><path d="m13 18 6-6-6-6"/>');
const ICON_INSERT_ROW_ABOVE = svg('<path d="M5 3h14"/><path d="M12 21V7"/><path d="m8 11 4-4 4 4"/>');
const ICON_INSERT_ROW_BELOW = svg('<path d="M5 21h14"/><path d="M12 3v14"/><path d="m8 13 4 4 4-4"/>');
const ICON_DELETE = svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>');

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
      header.push({ text: readCellSource(th) });
    });
  }
  // Pad if DOM has fewer header cells than expected (defensive).
  while (header.length < cols) header.push({ text: '' });

  const rows: { text: string }[][] = [];
  root.querySelectorAll('tbody > tr').forEach((tr) => {
    const row: { text: string }[] = [];
    tr.querySelectorAll('td').forEach((td) => {
      row.push({ text: readCellSource(td) });
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
 * Render a non-focused cell with inline markdown formatting applied, and stash
 * the markdown source on `dataset.lpSrc`. The source — not the formatted DOM —
 * is what `readCellSource` returns at serialization time, so the markers
 * survive even though they aren't visible. For plain text this produces the
 * exact same DOM as `setCellContent`.
 */
function renderCellContent(cell: HTMLElement, text: string): void {
  cell.replaceChildren();
  cell.appendChild(buildInlineFragment(text));
  cell.dataset.lpSrc = text;
}

/**
 * The markdown source of a cell. The focused cell is read live from the DOM
 * (it holds raw, editable text); every other cell is rendered, so its visible
 * text omits markers — we read the stashed `dataset.lpSrc` instead.
 */
function readCellSource(cell: HTMLElement): string {
  if (cell === cell.ownerDocument.activeElement) return readCellText(cell);
  return cell.dataset.lpSrc ?? readCellText(cell);
}

/** Collapse the selection to the end of a cell's content. */
function caretToEnd(cell: HTMLElement): void {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(cell);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Apply an inline markdown wrap (`**`, `_`, `~~`, `` ` ``) to the selection
 * inside a focused table cell, then push the edit through the cell's normal
 * serialization pipeline (a synthetic `input`). Operates on the cell's own DOM
 * selection — when focused the cell holds raw, editable text — mirroring the
 * CM6 toolbar's `wrapSelection`. Used by the toolbar buttons and the in-cell
 * Mod-b / Mod-i shortcuts. Returns false when there is no usable selection.
 */
export function wrapCellSelection(cell: HTMLElement, marker: string): boolean {
  const sel = cell.ownerDocument.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!cell.contains(range.commonAncestorContainer)) return false;

  const { insert, anchor, head } = computeInlineWrap(range.toString(), marker);

  range.deleteContents();
  const textNode = cell.ownerDocument.createTextNode(insert);
  range.insertNode(textNode);

  // Re-select the wrapped core so a second press toggles it off and the user
  // sees what changed. `insert` is one text node, so computeInlineWrap's
  // relative offsets map straight onto it.
  const newRange = cell.ownerDocument.createRange();
  newRange.setStart(textNode, Math.min(anchor, insert.length));
  newRange.setEnd(textNode, Math.min(head, insert.length));
  sel.removeAllRanges();
  sel.addRange(newRange);

  // Serialize the table + write back to the CM6 doc via the existing handler.
  cell.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
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

/** Move browser focus to a cell, placing the caret at the end of its text.
 *  The cell's own `focus` listener reveals raw source first (if formatted); the
 *  caret is then collapsed to the end of that source. */
function focusCell(root: HTMLElement, row: number, col: number): void {
  const el = cellAt(root, row, col);
  if (!el) return;
  el.focus();
  caretToEnd(el);
}

export class TableWidget extends WidgetType {
  /** Tracks IME composition per widget instance to suppress dispatches mid-compose. */
  private composing = false;
  /** Current view, captured by `toDOM` / `updateDOM`. CM6 always passes the
   *  active view into both methods, so listeners can rely on this being
   *  fresh for the lifetime of the DOM root. */
  private view: EditorView | null = null;

  /** Throttle flag for reposition-on-scroll (one rAF per scroll burst). */
  private scrollScheduled = false;

  constructor(
    public readonly table: ParsedTable,
    public readonly labels: TableWidgetLabels
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof TableWidget)) return false;
    // Structure drives focus retention (same shape → updateDOM keeps the caret).
    // Labels are compared too so a locale change forces a rebuild with fresh
    // tooltips; they never change mid-typing, so focus retention is unaffected.
    return sameTableStructure(this.table, other.table) && sameLabels(this.labels, other.labels);
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
      renderCellContent(th, cell.text);
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
        renderCellContent(td, cell.text);
        this.attachCellListeners(td, { row: rowIdx, col });
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tableEl.appendChild(tbody);
    root.appendChild(tableEl);

    // Wrap the scroll container in a non-clipping outer so the floating
    // toolbars (column bar above the table, row bar at its left) can extend
    // beyond the scroll area. `.cm-lp-table-wrap` sets `overflow-x: auto`,
    // which CSS promotes overflow-y to `auto` too — anything positioned outside
    // it would be clipped, hence the separate outer element.
    const outer = document.createElement('div');
    outer.className = 'cm-lp-table-outer';
    outer.appendChild(root);
    outer.appendChild(this.buildColumnBar(outer));
    outer.appendChild(this.buildRowBar(outer));

    // Hide the toolbars when the pointer leaves the table (unless a cell still
    // holds focus) and when focus moves out of the table entirely.
    outer.addEventListener('pointerleave', () => {
      delete outer.dataset.hr;
      delete outer.dataset.hc;
      this.syncToolbars(outer);
    });
    outer.addEventListener('focusout', () => {
      // Defer so `document.activeElement` settles on the new target first.
      requestAnimationFrame(() => this.syncToolbars(outer));
    });
    // Horizontal table scroll slides the columns under the (outer-anchored)
    // column bar — realign it. rAF-throttled to one update per scroll burst.
    root.addEventListener('scroll', () => {
      if (this.scrollScheduled) return;
      this.scrollScheduled = true;
      requestAnimationFrame(() => {
        this.scrollScheduled = false;
        this.syncToolbars(outer);
      });
    });

    return outer;
  }

  /**
   * Update cell text without rebuilding the DOM tree, preserving focus and
   * caret in any cell the user is currently editing. Returns true if the
   * existing root can host the new state — if structure changed (unlikely
   * because `eq()` already filtered) we bail out and let CM6 rebuild.
   */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    this.view = view;
    if (!dom.classList.contains('cm-lp-table-outer')) return false;
    const tableEl = dom.querySelector<HTMLElement>('table.cm-lp-table');
    if (!tableEl) return false;

    const cols = this.table.header.length;
    const headerCells = tableEl.querySelectorAll<HTMLElement>('thead > tr > th');
    if (headerCells.length !== cols) return false;
    const bodyRows = tableEl.querySelectorAll<HTMLElement>('tbody > tr');
    if (bodyRows.length !== this.table.rows.length) return false;

    const active = document.activeElement;

    // The focused cell holds raw, editable source — never touch it (that would
    // wipe the caret). Every other cell is re-rendered from its target source
    // only when that source actually changed, keyed off the stashed `lpSrc`.
    headerCells.forEach((th, col) => {
      const target = this.table.header[col]?.text ?? '';
      th.style.textAlign = alignStyle(this.table.alignments[col]);
      if (th === active) return;
      if (th.dataset.lpSrc !== target) renderCellContent(th, target);
    });

    bodyRows.forEach((tr, rowIdx) => {
      const cells = tr.querySelectorAll<HTMLElement>('td');
      if (cells.length !== cols) return;
      cells.forEach((td, col) => {
        const target = this.table.rows[rowIdx]?.[col]?.text ?? '';
        td.style.textAlign = alignStyle(this.table.alignments[col]);
        if (td === active) return;
        if (td.dataset.lpSrc !== target) renderCellContent(td, target);
      });
    });

    // Cell widths can shift as text is typed — keep the floating toolbars aligned.
    this.syncToolbars(dom);
    return true;
  }

  /** Block CM6 from interpreting clicks/keys inside cells as editor input. */
  ignoreEvent(): boolean {
    return true;
  }

  // ─── Event wiring ───────────────────────────────────────────────

  private attachCellListeners(cell: HTMLElement, addr: CellAddress): void {
    // Reveal raw markdown source when the cell is focused (so it can be edited),
    // and re-render the formatted view when focus leaves. A plain cell renders
    // identically raw and formatted, so it skips the swap — that keeps the
    // browser's native click-to-position caret instead of jumping to the end.
    cell.addEventListener('focus', () => {
      const src = cell.dataset.lpSrc ?? readCellText(cell);
      if (cellHasFormatting(src)) {
        setCellContent(cell, src);
        caretToEnd(cell);
      }
      // A focused cell takes over as the toolbars' target (focus beats hover).
      const outer = cell.closest<HTMLElement>('.cm-lp-table-outer');
      if (outer) this.syncToolbars(outer);
    });
    cell.addEventListener('blur', () => {
      renderCellContent(cell, readCellText(cell));
    });

    // Hover targets the toolbars when no cell is focused (mouse discovery).
    // `outer`'s `pointerleave` clears this; toolbar buttons live outside the
    // cells, so the last hovered cell stays the target while the pointer is on
    // a button (which is what its click handler reads).
    cell.addEventListener('pointerenter', () => {
      const outer = cell.closest<HTMLElement>('.cm-lp-table-outer');
      if (!outer) return;
      outer.dataset.hr = String(addr.row);
      outer.dataset.hc = String(addr.col);
      this.syncToolbars(outer);
    });

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

    // Bold / italic shortcuts. Handle them here because the widget sets
    // `ignoreEvent() = true`, so CM6's `Mod-b`/`Mod-i` keymap never sees keys
    // typed inside a cell. Also stops the browser's contenteditable default,
    // which would inject `<b>`/`<i>` HTML instead of markdown.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        e.preventDefault();
        wrapCellSelection(cell, key === 'b' ? '**' : '_');
        return;
      }
    }

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
    // `root` may be the wrap (keyboard path) or the outer — both contain the
    // table, which is all `applyStructuralOp` needs.
    this.applyStructuralOp(
      root,
      (snap) => insertRow(snap, snap.rows.length - 1, 'below'),
      () => ({ row: newRowIdx, col: 0 })
    );
  }

  /**
   * The shared edit core for every structural change (row/column insert &
   * delete, alignment): snapshot the live DOM, apply a pure transform, serialize
   * to GFM, and dispatch one change. Because structure differs, CM6 rebuilds the
   * widget (`eq` false → `toDOM`); the rebuilt DOM replaces ours, so we look it
   * up by position and re-focus `target` on the next frame. `container` may be
   * the wrap or the outer — both descend to the table.
   */
  private applyStructuralOp(
    container: HTMLElement,
    transform: (snap: SerializeInput) => SerializeInput,
    target: (next: SerializeInput) => CellAddress
  ): void {
    const view = this.view;
    if (!view) return;
    const tableEl = container.querySelector<HTMLElement>('table.cm-lp-table');
    if (!tableEl) return;
    const range = findTableRange(view, tableEl);
    if (!range) return;

    // Read the AUTHORITATIVE current table straight from the document text, not
    // from `this.table`. The widget instance bound to these toolbar handlers can
    // be stale: a cell edit (or an incremental re-parse) updates the doc through
    // `updateDOM`, which keeps the original `toDOM`'s button closures - so
    // `this.table.alignments` may lag behind the doc. The doc is always current.
    // Cell *content* still comes from the live DOM (the focused cell may hold an
    // uncommitted keystroke); column count + alignments come from the doc.
    const current = parseTableMarkdown(view.state.doc.sliceString(range.from, range.to));
    const cols = current.header.length;
    const dom = readDomTable(container, cols);
    const next = transform({
      header: dom.header,
      rows: dom.rows,
      alignments: current.alignments
    });
    const newMd = serializeTable(next);
    if (view.state.doc.sliceString(range.from, range.to) === newMd) return; // No-op.

    view.dispatch({
      changes: { from: range.from, to: range.to, insert: newMd },
      annotations: tableCellEditAnnotation.of(true)
    });

    const tgt = target(next);
    requestAnimationFrame(() => {
      const v = this.view;
      // Bail if the editor was torn down between the dispatch and this frame
      // (e.g. the note was closed): `domAtPos` throws on a destroyed view.
      if (!v || !v.dom.isConnected) return;
      const node = v.domAtPos(range.from)?.node as Node | null;
      const newWrap =
        (node instanceof HTMLElement
          ? node.querySelector<HTMLElement>('div.cm-lp-table-wrap')
          : null) ?? v.dom.querySelector<HTMLElement>('div.cm-lp-table-wrap');
      if (newWrap) focusCell(newWrap, tgt.row, tgt.col);
    });
  }

  // ─── Structural mini-toolbar ────────────────────────────────────
  //
  // Two contextual bars (Obsidian-style): a column bar floating above the active
  // column (alignment + insert left/right + delete) and a row bar at the table's
  // left edge, level with the active row (insert above/below + delete). The
  // "active" cell is the focused cell, falling back to the last-hovered cell —
  // both read from the DOM so the toolbars survive the widget's ephemeral
  // instances. Every button routes through `applyStructuralOp`.

  private buildColumnBar(outer: HTMLElement): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'cm-lp-table-colbar';
    bar.style.display = 'none';
    const L = this.labels;
    bar.append(
      this.makeBtn('align-left', ICON_ALIGN_LEFT, L.alignLeft, () => this.opAlign(outer, 'left')),
      this.makeBtn('align-center', ICON_ALIGN_CENTER, L.alignCenter, () => this.opAlign(outer, 'center')),
      this.makeBtn('align-right', ICON_ALIGN_RIGHT, L.alignRight, () => this.opAlign(outer, 'right')),
      this.makeSep(),
      this.makeBtn('insert-col-left', ICON_INSERT_COL_LEFT, L.insertColumnLeft, () =>
        this.opInsertColumn(outer, 'left')
      ),
      this.makeBtn('insert-col-right', ICON_INSERT_COL_RIGHT, L.insertColumnRight, () =>
        this.opInsertColumn(outer, 'right')
      ),
      this.makeSep(),
      this.makeBtn('delete-col', ICON_DELETE, L.deleteColumn, () => this.opDeleteColumn(outer), true)
    );
    return bar;
  }

  private buildRowBar(outer: HTMLElement): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'cm-lp-table-rowbar';
    bar.style.display = 'none';
    const L = this.labels;
    bar.append(
      this.makeBtn('insert-row-above', ICON_INSERT_ROW_ABOVE, L.insertRowAbove, () =>
        this.opInsertRow(outer, 'above')
      ),
      this.makeBtn('insert-row-below', ICON_INSERT_ROW_BELOW, L.insertRowBelow, () =>
        this.opInsertRow(outer, 'below')
      ),
      this.makeSep(),
      this.makeBtn('delete-row', ICON_DELETE, L.deleteRow, () => this.opDeleteRow(outer), true)
    );
    return bar;
  }

  private makeBtn(
    extraClass: string,
    icon: string,
    label: string,
    onClick: () => void,
    danger = false
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = `cm-lp-table-btn cm-lp-table-${extraClass}${danger ? ' is-danger' : ''}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon; // Trusted static SVG (no user input) — same as code-copy / TOC.
    // Keep the active cell focused (and the hover target intact) on press —
    // otherwise mousedown blurs the cell and `focusout` would hide the toolbars
    // before the click handler runs.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return b;
  }

  private makeSep(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'cm-lp-table-sep';
    return s;
  }

  // ── Toolbar operations ──

  private opAlign(outer: HTMLElement, align: CellAlign): void {
    const active = this.activeCell(outer);
    if (!active) return;
    this.applyStructuralOp(outer, (snap) => setColumnAlignment(snap, active.col, align), () => active);
  }

  private opInsertColumn(outer: HTMLElement, side: ColumnSide): void {
    const active = this.activeCell(outer);
    if (!active) return;
    const targetCol = side === 'left' ? active.col : active.col + 1;
    this.applyStructuralOp(
      outer,
      (snap) => insertColumn(snap, active.col, side),
      () => ({ row: active.row, col: targetCol })
    );
  }

  private opDeleteColumn(outer: HTMLElement): void {
    const active = this.activeCell(outer);
    if (!active) return;
    this.applyStructuralOp(
      outer,
      (snap) => deleteColumn(snap, active.col),
      (next) => ({ row: active.row, col: Math.min(active.col, next.header.length - 1) })
    );
  }

  private opInsertRow(outer: HTMLElement, side: RowSide): void {
    const active = this.activeCell(outer);
    if (!active) return;
    if (active.row === -1 && side === 'above') return; // Header has no "above".
    const newRowIdx = active.row === -1 ? 0 : side === 'above' ? active.row : active.row + 1;
    this.applyStructuralOp(
      outer,
      (snap) => insertRow(snap, active.row, side),
      () => ({ row: newRowIdx, col: Math.max(active.col, 0) })
    );
  }

  private opDeleteRow(outer: HTMLElement): void {
    const active = this.activeCell(outer);
    if (!active || active.row === -1) return; // Header can't be deleted.
    this.applyStructuralOp(
      outer,
      (snap) => deleteRow(snap, active.row),
      (next) =>
        next.rows.length === 0
          ? { row: -1, col: Math.min(active.col, next.header.length - 1) }
          : {
              row: Math.min(active.row, next.rows.length - 1),
              col: Math.min(active.col, next.header.length - 1)
            }
    );
  }

  // ── Toolbar state + geometry ──

  /** The toolbars' target: the focused cell, else the last-hovered cell. */
  private activeCell(outer: HTMLElement): CellAddress | null {
    const a = outer.ownerDocument.activeElement;
    if (a instanceof HTMLElement && (a.tagName === 'TD' || a.tagName === 'TH') && outer.contains(a)) {
      return { row: Number(a.dataset.row), col: Number(a.dataset.col) };
    }
    const hr = outer.dataset.hr;
    const hc = outer.dataset.hc;
    if (hr !== undefined && hc !== undefined) return { row: Number(hr), col: Number(hc) };
    return null;
  }

  /**
   * Show, position, and update both toolbars from the current target cell, or
   * hide them when there is none. All reads come from the DOM so it stays
   * correct across the widget's ephemeral instances.
   *
   * Geometry anchors to the ACTIVE CELL (not the table), so the bars stay next
   * to where the user is working and never scroll off with a tall/wide table -
   * the edited cell is by definition on-screen. Positions are bounding-rect
   * based, relative to the non-clipping `outer`, and kept inside the editor's
   * scroll viewport via flip (column bar: above ↔ below) and clamp (row bar to
   * the left edge; both bars on their cross axis).
   */
  private syncToolbars(outer: HTMLElement): void {
    const colbar = outer.querySelector<HTMLElement>('.cm-lp-table-colbar');
    const rowbar = outer.querySelector<HTMLElement>('.cm-lp-table-rowbar');
    if (!colbar || !rowbar) return;

    const active = this.activeCell(outer);
    const wrap = outer.querySelector<HTMLElement>('.cm-lp-table-wrap');
    const activeCellEl = active ? cellAt(outer, active.row, active.col) : null;
    if (!active || !wrap || !activeCellEl) {
      colbar.style.display = 'none';
      rowbar.style.display = 'none';
      this.setColumnHighlight(outer, null);
      return;
    }

    const colCount = outer.querySelectorAll('thead > tr > th').length;
    const bodyCount = outer.querySelectorAll('tbody > tr').length;
    const isHeader = active.row === -1;

    // Column bar: highlight the active column's alignment, and block deleting the
    // last column. Read the alignment from the active cell's RENDERED `text-align`
    // (what the user sees), not from `this.table.alignments`: after a toolbar
    // alignment change the bound widget instance can lag the doc/DOM (updateDOM
    // keeps the original toDOM closures), so the instance's alignments would
    // highlight the wrong icon - or none. `''` (GFM default) maps to no active
    // button, matching the prior behaviour.
    const al = activeCellEl.style.textAlign;
    this.setBtnActive(colbar, '.cm-lp-table-align-left', al === 'left');
    this.setBtnActive(colbar, '.cm-lp-table-align-center', al === 'center');
    this.setBtnActive(colbar, '.cm-lp-table-align-right', al === 'right');
    this.setBtnDisabled(colbar, '.cm-lp-table-delete-col', colCount <= 1);

    // Row bar: the header has no "above" and can't be deleted; an empty body
    // has nothing to delete.
    this.setBtnDisabled(rowbar, '.cm-lp-table-insert-row-above', isHeader);
    this.setBtnDisabled(rowbar, '.cm-lp-table-delete-row', isHeader || bodyCount === 0);

    colbar.style.display = 'flex';
    rowbar.style.display = 'flex';

    const outerRect = outer.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const cellRect = activeCellEl.getBoundingClientRect();

    // Hide both bars when the active column is scrolled out of the table's
    // horizontal viewport (the wrap clips overflow-x) - a bar pointing at an
    // off-screen cell would mislead.
    if (cellRect.right <= wrapRect.left + 1 || cellRect.left >= wrapRect.right - 1) {
      colbar.style.display = 'none';
      rowbar.style.display = 'none';
      this.setColumnHighlight(outer, null);
      return;
    }

    // Stay within the editor's scroll viewport (intersected with the window),
    // so the bars never clip off-screen no matter how large the table is.
    const view = this.view;
    const vp = view ? view.scrollDOM.getBoundingClientRect() : null;
    const vpTop = Math.max(vp ? vp.top : 0, 0);
    const vpLeft = Math.max(vp ? vp.left : 0, 0);
    const vpRight = Math.min(vp ? vp.right : window.innerWidth, window.innerWidth);
    const vpBottom = Math.min(vp ? vp.bottom : window.innerHeight, window.innerHeight);
    const GAP = 4;

    // Column bar: above the active cell, flipped below when it would clip the
    // top edge; aligned to the cell's left, clamped within the viewport width.
    const colW = colbar.offsetWidth;
    const colH = colbar.offsetHeight;
    let colTop = cellRect.top - colH - GAP;
    if (colTop < vpTop) colTop = cellRect.bottom + GAP; // flip below
    colTop = Math.max(vpTop, Math.min(colTop, vpBottom - colH));
    const colLeft = Math.max(vpLeft, Math.min(cellRect.left, vpRight - colW));
    colbar.style.left = `${Math.round(colLeft - outerRect.left)}px`;
    colbar.style.top = `${Math.round(colTop - outerRect.top)}px`;

    // Row bar: to the left of the active cell, clamped to the viewport's left
    // edge (so it stays put when a wide table scrolls horizontally); centered on
    // the cell vertically, clamped within the viewport height.
    const rowW = rowbar.offsetWidth;
    const rowH = rowbar.offsetHeight;
    const rowLeft = Math.max(vpLeft, cellRect.left - rowW - GAP);
    let rowTop = cellRect.top + (cellRect.height - rowH) / 2;
    rowTop = Math.max(vpTop, Math.min(rowTop, vpBottom - rowH));
    rowbar.style.left = `${Math.round(rowLeft - outerRect.left)}px`;
    rowbar.style.top = `${Math.round(rowTop - outerRect.top)}px`;

    // Tint the whole active column so the column-scoped buttons (alignment,
    // insert-column, delete-column) visibly act on the column, not just the cell.
    this.setColumnHighlight(outer, active.col);
  }

  /**
   * Tint every cell of the active column (header + body) while its column bar is
   * visible, signalling that alignment / insert-column / delete-column act on the
   * whole column - GFM stores alignment per column (in the delimiter row), never
   * per cell. Idempotent: clears the previous highlight first, so it stays
   * correct across the widget's ephemeral `toDOM`/`updateDOM` instances. Pass
   * `col === null` to clear (bars hidden / no active cell).
   */
  private setColumnHighlight(outer: HTMLElement, col: number | null): void {
    outer
      .querySelectorAll<HTMLElement>('.cm-lp-col-active')
      .forEach((el) => el.classList.remove('cm-lp-col-active'));
    if (col === null) return;
    outer
      .querySelectorAll<HTMLElement>(`[data-col="${col}"]`)
      .forEach((el) => el.classList.add('cm-lp-col-active'));
  }

  private setBtnActive(bar: HTMLElement, sel: string, on: boolean): void {
    bar.querySelector(sel)?.classList.toggle('is-active', on);
  }

  private setBtnDisabled(bar: HTMLElement, sel: string, off: boolean): void {
    bar.querySelector(sel)?.toggleAttribute('disabled', off);
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

    // Authoritative column count + alignments from the doc, not the (possibly
    // stale) widget instance - same reasoning as `applyStructuralOp`. Without
    // this, typing in a cell after a column/alignment change could revert that
    // change, because `this.table` lags the doc when edits flow through
    // `updateDOM`. Content comes from the live DOM.
    const currentMd = view.state.doc.sliceString(range.from, range.to);
    const current = parseTableMarkdown(currentMd);
    const cols = current.header.length;
    const dom = readDomTable(root, cols);
    const newMd = serializeTable({
      header: dom.header,
      rows: dom.rows,
      alignments: current.alignments
    });

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
