/**
 * Zero-width sentinel for empty sub-list bullets created via the toolbar.
 *
 * `@lezer/markdown` exhibits a CommonMark-adjacent asymmetry: an empty sub
 * `OrderedList` line (`   1. `) parses as a sub-list, but an empty sub
 * `BulletList` line (`   * ` / `   - `) is treated as paragraph continuation
 * of the outer ListItem. Live Preview then can't apply `cm-lp-bullet-d{N}`
 * decoration and the bullet visually drops to column 0 until the user types
 * real content.
 *
 * Workaround: when the toolbar produces an empty sub-bullet, append a
 * zero-width space after the marker so the parser sees content and emits a
 * BulletList. `stripBulletAnchorListener` removes the sentinel on the next
 * doc change that adds substantive content, so the saved markdown stays
 * clean. The anchor is therefore only ever present for the brief window
 * between toolbar click and first keystroke.
 *
 * Scope: toolbar conversions only. Direct typing of `   * ` reproduces the
 * same parse asymmetry but rewriting user keystrokes is out of scope here.
 */
import type { Extension } from '@codemirror/state';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const BULLET_ANCHOR = '​';

const BULLET_PREFIX_RE = /^[-+*] $/;
const LIST_LINE_WITH_CONTENT_RE = /^(\s*)(?:[-+*]|\d+[.)])\s+(.*[^\s\u200B].*)$/;

/**
 * Decides whether `prefixLine` should append `BULLET_ANCHOR` after the
 * marker. True only for the bug-triggering shape:
 *   - prefix is a bullet marker (`* ` / `- ` / `+ `)
 *   - resulting content after marker is empty
 *   - line has leading indentation (i.e., a sub-list)
 *
 * Top-level empty bullets parse fine, so we skip the anchor there to avoid
 * pointless cleanup churn.
 */
export function shouldInsertBulletAnchor(
  prefix: string,
  indent: string,
  stripped: string
): boolean {
  if (stripped.length > 0) return false;
  if (indent.length === 0) return false;
  return BULLET_PREFIX_RE.test(prefix);
}

/**
 * True when a list-item line still carries `BULLET_ANCHOR` AND has at least
 * one non-whitespace, non-anchor character after the marker — i.e., the user
 * has typed real content and the sentinel has done its job.
 */
export function shouldStripAnchor(lineText: string): boolean {
  if (!lineText.includes(BULLET_ANCHOR)) return false;
  return LIST_LINE_WITH_CONTENT_RE.test(lineText);
}

/**
 * Removes `BULLET_ANCHOR` from list-item lines once the user has typed real
 * content there. Dispatched as a separate, history-excluded transaction so
 * undo only steps through user-visible edits.
 *
 * The async `Promise.resolve().then(...)` queue mirrors
 * `livePreviewSyncListener` — dispatching synchronously inside an
 * updateListener triggers a CM6 reentrancy assertion.
 *
 * Scan is bounded to lines touched by the current update, so cost is O(edit
 * size) regardless of document length.
 */
export const stripBulletAnchorListener: Extension = EditorView.updateListener.of(
  (update) => {
    if (!update.docChanged) return;
    const doc = update.state.doc;
    const visited = new Set<number>();

    update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const fromLine = doc.lineAt(fromB).number;
      const toLine = doc.lineAt(toB).number;
      for (let n = fromLine; n <= toLine; n++) visited.add(n);
    });

    const changes: Array<{ from: number; to: number; insert: string }> = [];
    for (const n of visited) {
      if (n < 1 || n > doc.lines) continue;
      const line = doc.line(n);
      if (!shouldStripAnchor(line.text)) continue;

      let i = -1;
      while ((i = line.text.indexOf(BULLET_ANCHOR, i + 1)) >= 0) {
        changes.push({ from: line.from + i, to: line.from + i + 1, insert: '' });
      }
    }

    if (changes.length === 0) return;

    const view = update.view;
    Promise.resolve().then(() => {
      view.dispatch({
        changes,
        annotations: Transaction.addToHistory.of(false)
      });
    });
  }
);
