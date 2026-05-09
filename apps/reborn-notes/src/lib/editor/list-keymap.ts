/**
 * List-aware Tab / Shift-Tab commands for the markdown editor.
 *
 * `@codemirror/commands` ships `indentWithTab` (Tab → indentMore, Shift-Tab →
 * indentLess), which is markdown-blind: it inserts/removes one `indentUnit`
 * (default 2 spaces) regardless of list semantics. CommonMark requires a
 * sub-list line to be indented by at least the parent item's content column —
 * marker width + space. For `1. ` that's 3 chars; for `- ` it's 2. The default
 * 2-space step works only by accident for bullets and breaks for ordered
 * lists (user has to press Tab twice).
 *
 * `listIndent` / `listOutdent` replace Tab / Shift-Tab when the cursor sits on
 * the first line of a `ListItem`. They:
 *   - compute the indent step from the previous sibling's marker width,
 *   - rewrite the moving item's marker to `1.` on indent (sub-list starts
 *     at 1) and to `parent + N` on outdent (joins outer sequence),
 *   - renumber outer / inner lists to close gaps left behind.
 *
 * Outside list context — or in MVP edge cases (first item on indent, non-last
 * sub-item on outdent, multi-line selection, continuation lines) — the
 * commands return `false` so the editor's default `indentWithTab` takes over.
 */
import type { Command } from '@codemirror/view';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

const ORDERED_MARKER_RE = /^(\s*)(\d+)([.)])(\s+)/;
const BULLET_MARKER_RE = /^(\s*)([-+*])(\s+)/;

interface ListItemInfo {
  item: SyntaxNode;
  list: SyntaxNode;
  ordered: boolean;
  lineFrom: number;
  leadingWs: number;
  markerWidth: number;
  markerNumber: number | undefined;
}

function resolveListItem(tree: ReturnType<typeof syntaxTree>, pos: number): SyntaxNode | null {
  for (const side of [-1, 1] as const) {
    let n: SyntaxNode | null = tree.resolveInner(pos, side);
    // `@lezer/markdown`'s GFM `TaskList` adds a `Task` block node *inside* a
    // ListItem (alongside ListMark) — so walking up from the cursor to find
    // a list item is a plain ListItem walk, even on task lines.
    while (n && n.name !== 'ListItem') n = n.parent;
    if (n) return n;
  }
  return null;
}

function listItemAt(state: EditorState, pos: number): ListItemInfo | null {
  const tree = syntaxTree(state);
  const n = resolveListItem(tree, pos);
  if (!n) return null;

  const list = n.parent;
  if (!list || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return null;

  const itemLine = state.doc.lineAt(n.from);
  const cursorLine = state.doc.lineAt(pos);
  if (cursorLine.from !== itemLine.from) return null;

  const ordered = list.name === 'OrderedList';
  const re = ordered ? ORDERED_MARKER_RE : BULLET_MARKER_RE;
  const m = re.exec(itemLine.text);
  if (!m) return null;

  const leadingWs = m[1].length;
  const markerWidth = m[0].length - leadingWs;
  return {
    item: n,
    list,
    ordered,
    lineFrom: itemLine.from,
    leadingWs,
    markerWidth,
    markerNumber: ordered ? parseInt(m[2], 10) : undefined
  };
}

/**
 * Lezer `SyntaxNode` instances are recreated on each accessor call (e.g. each
 * `tree.resolveInner` or `nextSibling` returns a fresh wrapper), so `===` is
 * unreliable for identity. Compare by name + range — sufficient since two
 * sibling `ListItem`s under the same `*List` cannot share both bounds.
 */
function sameNode(a: SyntaxNode, b: SyntaxNode): boolean {
  return a.name === b.name && a.from === b.from && a.to === b.to;
}

function previousSibling(item: SyntaxNode, list: SyntaxNode): SyntaxNode | null {
  let prev: SyntaxNode | null = null;
  for (let c: SyntaxNode | null = list.firstChild; c; c = c.nextSibling) {
    if (sameNode(c, item)) return prev;
    if (c.name === 'ListItem') prev = c;
  }
  return null;
}

function isLastSibling(item: SyntaxNode, list: SyntaxNode): boolean {
  let foundSelf = false;
  for (let c: SyntaxNode | null = list.firstChild; c; c = c.nextSibling) {
    if (foundSelf && c.name === 'ListItem') return false;
    if (sameNode(c, item)) foundSelf = true;
  }
  return foundSelf;
}

function siblingMarkerWidth(state: EditorState, sibling: SyntaxNode): number {
  const line = state.doc.lineAt(sibling.from);
  const m = ORDERED_MARKER_RE.exec(line.text) ?? BULLET_MARKER_RE.exec(line.text);
  return m ? m[0].length - m[1].length : 2;
}

type IndentResult = { changes: ChangeSpec[] } | 'noop' | null;

/**
 * Compute the change set for a list-aware Tab. Returns `null` if the caller
 * should fall through to the default keymap, `'noop'` if the keystroke is
 * intentionally swallowed (first item of a list — nothing to nest under),
 * or a `{ changes }` object to dispatch.
 */
export function tryListIndent(state: EditorState): IndentResult {
  const ranges = state.selection.ranges;
  if (ranges.length !== 1 || !ranges[0].empty) return null;
  const info = listItemAt(state, ranges[0].from);
  if (!info) return null;

  const prev = previousSibling(info.item, info.list);
  if (!prev) return 'noop';

  const step = siblingMarkerWidth(state, prev);
  const changes: ChangeSpec[] = [];
  changes.push({ from: info.lineFrom, insert: ' '.repeat(step) });

  if (info.ordered && info.markerNumber !== 1) {
    const numFrom = info.lineFrom + info.leadingWs;
    const numTo = numFrom + String(info.markerNumber).length;
    changes.push({ from: numFrom, to: numTo, insert: '1' });
  }

  if (info.ordered) {
    let firstNum: number | null = null;
    let n: number | null = null;
    for (let c: SyntaxNode | null = info.list.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'ListItem') continue;
      if (sameNode(c, info.item)) continue;
      const line = state.doc.lineAt(c.from);
      const m = ORDERED_MARKER_RE.exec(line.text);
      if (!m) continue;
      if (firstNum === null) {
        firstNum = parseInt(m[2], 10);
        n = firstNum + 1;
        continue;
      }
      const cur = parseInt(m[2], 10);
      if (cur !== n) {
        const numFrom = line.from + m[1].length;
        const numTo = numFrom + m[2].length;
        changes.push({ from: numFrom, to: numTo, insert: String(n) });
      }
      n = (n as number) + 1;
    }
  }

  return { changes };
}

type OutdentResult = { changes: ChangeSpec[] } | null;

/**
 * Compute the change set for a list-aware Shift-Tab. Returns `null` to fall
 * through to the default keymap (top-level item, non-last sub-item, plain
 * text, multi-line selection, continuation line).
 */
export function tryListOutdent(state: EditorState): OutdentResult {
  const ranges = state.selection.ranges;
  if (ranges.length !== 1 || !ranges[0].empty) return null;
  const info = listItemAt(state, ranges[0].from);
  if (!info) return null;

  let p: SyntaxNode | null = info.list.parent;
  let grandItem: SyntaxNode | null = null;
  let grandList: SyntaxNode | null = null;
  while (p) {
    if (p.name === 'ListItem') {
      grandItem = p;
      grandList = p.parent;
      break;
    }
    p = p.parent;
  }
  if (!grandItem || !grandList) return null;
  if (grandList.name !== 'BulletList' && grandList.name !== 'OrderedList') return null;
  if (!isLastSibling(info.item, info.list)) return null;

  const grandLine = state.doc.lineAt(grandItem.from);
  const grandM = ORDERED_MARKER_RE.exec(grandLine.text) ?? BULLET_MARKER_RE.exec(grandLine.text);
  if (!grandM) return null;
  const parentMarkerWidth = grandM[0].length - grandM[1].length;
  const removeCount = Math.min(parentMarkerWidth, info.leadingWs);
  if (removeCount <= 0) return null;

  const changes: ChangeSpec[] = [];
  changes.push({ from: info.lineFrom, to: info.lineFrom + removeCount, insert: '' });

  if (info.ordered && grandList.name === 'OrderedList') {
    let firstNum: number | null = null;
    let n: number | null = null;
    let foundGrand = false;
    for (let c: SyntaxNode | null = grandList.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'ListItem') continue;
      const line = state.doc.lineAt(c.from);
      const m = ORDERED_MARKER_RE.exec(line.text);
      if (!m) continue;
      const numFrom = line.from + m[1].length;
      const numTo = numFrom + m[2].length;
      const cur = parseInt(m[2], 10);

      if (firstNum === null) {
        firstNum = cur;
        n = firstNum + 1;
        if (sameNode(c, grandItem)) {
          const ourMarker = info.markerNumber as number;
          const ourFrom = info.lineFrom + info.leadingWs;
          const ourTo = ourFrom + String(ourMarker).length;
          changes.push({ from: ourFrom, to: ourTo, insert: String(n) });
          n = (n as number) + 1;
          foundGrand = true;
        }
        continue;
      }

      if (sameNode(c, grandItem)) {
        if (cur !== n) {
          changes.push({ from: numFrom, to: numTo, insert: String(n) });
        }
        const grandNum = n as number;
        const ourMarker = info.markerNumber as number;
        const ourFrom = info.lineFrom + info.leadingWs;
        const ourTo = ourFrom + String(ourMarker).length;
        changes.push({ from: ourFrom, to: ourTo, insert: String(grandNum + 1) });
        n = grandNum + 2;
        foundGrand = true;
        continue;
      }

      if (cur !== n) {
        changes.push({ from: numFrom, to: numTo, insert: String(n) });
      }
      n = (n as number) + 1;
    }
    // Defensive: if grand was not found in its own list, skip renumbering.
    if (!foundGrand) {
      // Remove the inserted whitespace deletion only — outdent without
      // renumber is still valid for bullet sub-lists; but for ordered we'd
      // leave inconsistent numbering. Since we can't reliably renumber,
      // bail out by returning null so default indentLess takes over.
      return null;
    }
  }

  return { changes };
}

export const listIndent: Command = (view) => {
  const result = tryListIndent(view.state);
  if (result === null) return false;
  if (result === 'noop') return true;
  view.dispatch({ changes: result.changes, userEvent: 'input.indent.list' });
  return true;
};

export const listOutdent: Command = (view) => {
  const result = tryListOutdent(view.state);
  if (!result) return false;
  view.dispatch({ changes: result.changes, userEvent: 'delete.dedent.list' });
  return true;
};
