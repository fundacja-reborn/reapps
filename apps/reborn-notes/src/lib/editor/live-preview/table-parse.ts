/**
 * GFM table parser & serializer for Live Preview.
 *
 * `parseTable` walks a `Table` syntax-tree node from `@lezer/markdown` and
 * produces a typed structural view (header cells + body rows + per-column
 * alignment). `serializeTable` renders the same structure back to GFM markdown
 * for round-trip-safe edits from the rendered widget.
 *
 * The parser slices each `TableCell` from the editor doc and trims whitespace.
 * Pipes inside cells must be escaped as `\|` per GFM; we unescape on parse and
 * re-escape on serialize.
 */
import type { EditorState, Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

export type CellAlign = 'left' | 'right' | 'center' | null;

export interface ParsedCell {
  /** Position in editor doc — used for fine-grained re-mapping if ever needed. */
  from: number;
  to: number;
  /** Trimmed, unescaped cell text (display value used by the widget). */
  text: string;
}

export interface ParsedTable {
  /** Start of the `Table` node (first char of the header line). */
  from: number;
  /** End of the `Table` node (after the last body row). */
  to: number;
  header: ParsedCell[];
  rows: ParsedCell[][];
  /** Per-column alignment from the delimiter row (`:---`, `---:`, `:---:`). */
  alignments: CellAlign[];
}

/**
 * Reverse of `escapeCell`: `\\` → `\` and `\|` → `|`. Done in a single pass so
 * a sequence like `\\|` (escaped backslash followed by literal pipe in the
 * source — produced by serializing a cell containing `\|`) is decoded as `\|`,
 * not as `\` + escaped-pipe.
 */
export function unescapePipes(text: string): string {
  return text.replace(/\\([\\|])/g, '$1');
}

/**
 * Decode markdown cell text for display:
 *  1. unescape `\|` → `|`
 *  2. convert `<br>` / `<br/>` / `<br />` (case-insensitive) to `\n` so the
 *     widget can render multi-line cells. This mirrors the Obsidian convention
 *     for line breaks inside GFM table cells (the spec requires a single line
 *     per row, so `<br>` is the universal escape hatch).
 *  3. strip surrounding spaces/tabs only — keep leading/trailing newlines so
 *     the user's intentional blank lines aren't silently dropped.
 */
export function decodeCellText(raw: string): string {
  return unescapePipes(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/^[ \t]+|[ \t]+$/g, '');
}

/**
 * Escape cell text for serialization:
 *  1. literal `\` → `\\` (must come first — otherwise `\|` from the next pass
 *     would be ambiguous with a user-typed `\|` and could split the row when
 *     re-parsed).
 *  2. literal `|` → `\|`
 *  3. embedded newlines → `<br>` (GFM tables can't contain literal `\n`).
 */
export function escapeCell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function readCell(state: EditorState, cellNode: SyntaxNode): ParsedCell {
  const raw = state.doc.sliceString(cellNode.from, cellNode.to);
  return {
    from: cellNode.from,
    to: cellNode.to,
    text: decodeCellText(raw)
  };
}

function collectCells(state: EditorState, parent: SyntaxNode): ParsedCell[] {
  const out: ParsedCell[] = [];
  let child = parent.firstChild;
  while (child) {
    if (child.type.name === 'TableCell') out.push(readCell(state, child));
    child = child.nextSibling;
  }
  return out;
}

/**
 * Split a delimiter row (`| :--- | ---: |`) into its per-column segments,
 * tolerating extra whitespace and missing leading/trailing pipes (GFM allows
 * both `| a | b |` and `a | b`). The segment count is GFM's authoritative
 * column count for the table — see `parseTable`.
 */
function splitDelimiter(delimiterText: string): string[] {
  const trimmed = delimiterText.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((s) => s.trim());
}

/**
 * Parse the delimiter row into per-column alignment, padded/truncated to
 * `expectedCols`.
 */
function parseAlignments(delimiterText: string, expectedCols: number): CellAlign[] {
  const out: CellAlign[] = splitDelimiter(delimiterText).map((seg) => {
    const left = seg.startsWith(':');
    const right = seg.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
  // Pad / trim so length matches the column count.
  while (out.length < expectedCols) out.push(null);
  return out.slice(0, expectedCols);
}

/**
 * Parse a `Table` node into a structural view. Returns `null` if the node is
 * malformed (no header) — caller should fall back to raw markdown rendering.
 */
export function parseTable(state: EditorState, tableNode: SyntaxNode): ParsedTable | null {
  let header: ParsedCell[] | null = null;
  let delimiterText: string | null = null;
  const rows: ParsedCell[][] = [];

  let child = tableNode.firstChild;
  while (child) {
    const name = child.type.name;
    if (name === 'TableHeader') {
      header = collectCells(state, child);
    } else if (name === 'TableDelimiter' && header && delimiterText === null) {
      // Only the *block-level* TableDelimiter (separator row) is a direct
      // child of the Table node — single-pipe delimiters live inside Header
      // and Row nodes. So this branch reliably matches the alignment row.
      delimiterText = state.doc.sliceString(child.from, child.to);
    } else if (name === 'TableRow') {
      rows.push(collectCells(state, child));
    }
    child = child.nextSibling;
  }

  if (!header || header.length === 0) return null;

  // GFM defines the column count by the delimiter row, not the header.
  // `@lezer/markdown` drops a *trailing empty* header cell (`| A | B |   |`
  // yields only two `TableCell` nodes), so a freshly-inserted rightmost column
  // with an empty header would otherwise vanish on the next parse. Trust the
  // delimiter's segment count and pad the header to match.
  const delimCols = delimiterText !== null ? splitDelimiter(delimiterText).length : 0;
  const cols = Math.max(header.length, delimCols);
  while (header.length < cols) {
    header.push({ from: tableNode.to, to: tableNode.to, text: '' });
  }
  const padded: CellAlign[] =
    delimiterText !== null
      ? parseAlignments(delimiterText, cols)
      : Array.from({ length: cols }, () => null);

  // Normalize each row to header column count — short rows get empty cells,
  // long rows get truncated. Mirrors how the GFM spec / browser renderers behave.
  const normRows = rows.map((row) => {
    if (row.length === cols) return row;
    if (row.length > cols) return row.slice(0, cols);
    const out = row.slice();
    while (out.length < cols) {
      out.push({ from: tableNode.to, to: tableNode.to, text: '' });
    }
    return out;
  });

  return {
    from: tableNode.from,
    to: tableNode.to,
    header,
    rows: normRows,
    alignments: padded
  };
}

/** Build the delimiter segment (`---` / `:---` / `---:` / `:---:`). */
function delimiterSegment(align: CellAlign): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'right':
      return '---:';
    case 'center':
      return ':---:';
    default:
      return '---';
  }
}

export interface SerializeInput {
  header: { text: string }[];
  rows: { text: string }[][];
  alignments: CellAlign[];
}

/**
 * Render a structural table back to GFM markdown. Output format mirrors the
 * toolbar's "Insert table" template — leading/trailing pipes plus single-space
 * padding inside each cell so manual editing in raw mode stays readable.
 *
 * Empty cells render as `   ` (three spaces) to match the toolbar template
 * and to keep `parseRow` happy on subsequent re-parses.
 */
export function serializeTable(table: SerializeInput): string {
  const cols = table.header.length;
  const aligns: CellAlign[] = Array.from(
    { length: cols },
    (_, i) => table.alignments[i] ?? null
  );

  const renderCell = (text: string): string => {
    const escaped = escapeCell(text).trim();
    return escaped.length === 0 ? '   ' : ` ${escaped} `;
  };

  const headerLine =
    '|' + table.header.map((c) => renderCell(c.text)).join('|') + '|';
  const separatorLine =
    '|' + aligns.map((a) => ` ${delimiterSegment(a)} `).join('|') + '|';
  const bodyLines = table.rows.map((row) => {
    const cells = Array.from({ length: cols }, (_, i) => row[i]?.text ?? '');
    return '|' + cells.map(renderCell).join('|') + '|';
  });

  const lines = [headerLine, separatorLine, ...bodyLines];
  return lines.join('\n');
}

// ─── Structural operations ──────────────────────────────────────────
//
// Pure transforms over a `SerializeInput` snapshot, used by the table widget's
// mini-toolbar (add/remove column, insert row mid-table, change alignment).
// Each returns a fresh snapshot — never mutates its argument — so it can be
// piped straight into `serializeTable` → `view.dispatch`. They are DOM-free
// and unit-tested in `table-parse.test.ts`; the widget owns dispatch + refocus.

export type ColumnSide = 'left' | 'right';
export type RowSide = 'above' | 'below';

/** Snapshot clone so structural ops stay pure (no aliasing into the input). */
function cloneSnapshot(t: SerializeInput): SerializeInput {
  return {
    header: t.header.map((c) => ({ text: c.text })),
    rows: t.rows.map((r) => r.map((c) => ({ text: c.text }))),
    alignments: t.alignments.slice()
  };
}

/**
 * Insert an empty column to the `left` or `right` of `atCol`. Header, every
 * body row, and the alignment list all gain a slot at the same index; the new
 * column has no explicit alignment (`null`).
 */
export function insertColumn(t: SerializeInput, atCol: number, side: ColumnSide): SerializeInput {
  const next = cloneSnapshot(t);
  const idx = Math.max(0, Math.min(side === 'left' ? atCol : atCol + 1, next.header.length));
  next.header.splice(idx, 0, { text: '' });
  next.rows.forEach((r) => r.splice(idx, 0, { text: '' }));
  next.alignments.splice(idx, 0, null);
  return next;
}

/**
 * Remove column `atCol` from the header, every body row, and the alignment
 * list. No-op when only one column remains — a GFM table needs at least one.
 */
export function deleteColumn(t: SerializeInput, atCol: number): SerializeInput {
  const next = cloneSnapshot(t);
  if (next.header.length <= 1 || atCol < 0 || atCol >= next.header.length) return next;
  next.header.splice(atCol, 1);
  next.rows.forEach((r) => r.splice(atCol, 1));
  next.alignments.splice(atCol, 1);
  return next;
}

/**
 * Insert an empty body row `above` or `below` `atRow`. `atRow === -1` is the
 * header row, which has no "above" — both sides insert at the top of the body
 * (index 0), so a header-only table can grow its first body row.
 */
export function insertRow(t: SerializeInput, atRow: number, side: RowSide): SerializeInput {
  const next = cloneSnapshot(t);
  const blank = Array.from({ length: next.header.length }, () => ({ text: '' }));
  const idx =
    atRow === -1 ? 0 : Math.max(0, Math.min(side === 'above' ? atRow : atRow + 1, next.rows.length));
  next.rows.splice(idx, 0, blank);
  return next;
}

/**
 * Remove body row `atRow`. No-op for the header (`atRow === -1`) or any
 * out-of-range index; deleting the last body row leaves a valid header-only
 * table.
 */
export function deleteRow(t: SerializeInput, atRow: number): SerializeInput {
  const next = cloneSnapshot(t);
  if (atRow < 0 || atRow >= next.rows.length) return next;
  next.rows.splice(atRow, 1);
  return next;
}

/** Set column `atCol`'s alignment (`left`/`right`/`center`/`null`). */
export function setColumnAlignment(t: SerializeInput, atCol: number, align: CellAlign): SerializeInput {
  const next = cloneSnapshot(t);
  if (atCol < 0 || atCol >= next.header.length) return next;
  while (next.alignments.length < next.header.length) next.alignments.push(null);
  next.alignments[atCol] = align;
  return next;
}

/**
 * Test helper used by both `livePreviewSyncListener` and the widget — given
 * a Text doc and a `Table` node, return true if the structure (column count +
 * row count + alignments) matches another parsed table. Falls back to deep
 * equal of cell text for the focus-retention `eq()` path.
 */
export function sameTableStructure(a: ParsedTable, b: ParsedTable): boolean {
  if (a.header.length !== b.header.length) return false;
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.alignments.length; i++) {
    if (a.alignments[i] !== b.alignments[i]) return false;
  }
  return true;
}

/** Get the trimmed text of a cell from a parsed table — guard for missing rows. */
export function cellText(t: ParsedTable, row: number, col: number): string {
  if (row === -1) return t.header[col]?.text ?? '';
  return t.rows[row]?.[col]?.text ?? '';
}

/** Helper used by sync `Text` lookups in tests / debug. */
export function readDocText(doc: Text, from: number, to: number): string {
  return doc.sliceString(from, to);
}
