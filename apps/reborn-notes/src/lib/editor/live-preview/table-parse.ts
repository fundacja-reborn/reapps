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

/** GFM allows escaping `|` inside cells with `\|`. Decode for display. */
export function unescapePipes(text: string): string {
  return text.replace(/\\\|/g, '|');
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
 *  1. literal `|` → `\|`
 *  2. embedded newlines → `<br>` (GFM tables can't contain literal `\n`).
 */
export function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
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
 * Parses the delimiter row (`| :--- | ---: | :---: |`) and returns the
 * alignment per column. Robust to extra whitespace and missing leading/trailing
 * pipes (GFM allows both `| a | b |` and `a | b`).
 */
function parseAlignments(delimiterText: string, expectedCols: number): CellAlign[] {
  const trimmed = delimiterText.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = inner.split('|').map((s) => s.trim());
  const out: CellAlign[] = parts.map((seg) => {
    const left = seg.startsWith(':');
    const right = seg.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
  // Pad / trim so length matches header column count.
  while (out.length < expectedCols) out.push(null);
  return out.slice(0, expectedCols);
}

/**
 * Parse a `Table` node into a structural view. Returns `null` if the node is
 * malformed (no header) — caller should fall back to raw markdown rendering.
 */
export function parseTable(state: EditorState, tableNode: SyntaxNode): ParsedTable | null {
  let header: ParsedCell[] | null = null;
  let alignments: CellAlign[] | null = null;
  const rows: ParsedCell[][] = [];

  let child = tableNode.firstChild;
  while (child) {
    const name = child.type.name;
    if (name === 'TableHeader') {
      header = collectCells(state, child);
    } else if (name === 'TableDelimiter' && header && !alignments) {
      // Only the *block-level* TableDelimiter (separator row) is a direct
      // child of the Table node — single-pipe delimiters live inside Header
      // and Row nodes. So this branch reliably matches the alignment row.
      const text = state.doc.sliceString(child.from, child.to);
      alignments = parseAlignments(text, header.length);
    } else if (name === 'TableRow') {
      rows.push(collectCells(state, child));
    }
    child = child.nextSibling;
  }

  if (!header || header.length === 0) return null;

  const cols = header.length;
  const padded: CellAlign[] =
    alignments ?? Array.from({ length: cols }, () => null);

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
