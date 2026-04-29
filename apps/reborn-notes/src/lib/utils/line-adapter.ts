/**
 * Line-based scroll adapters used by toggle-preservation and split-view sync.
 *
 * An adapter is a thin two-method facade — `topLine()` and `scrollToLine()` —
 * over either the CodeMirror editor or the Markdown preview. The same
 * interface works whether the pane has its own scroll container (split view,
 * mobile keyboard mode) or rides the parent's scroll (desktop single-pane
 * with `parentScroll=true`).
 *
 * Why a single interface: the consumer (`scroll-sync.ts`) doesn't care how
 * the pane physically scrolls — it just asks "what line is at the top?" and
 * "scroll to this line". This is what makes the same primitive cover toggle
 * preservation, edit↔preview split sync, and (later) cursor-aware sync.
 *
 * Lines are passed as `number` (not `int`) — adapters interpolate sub-line
 * resolution from pixel offsets. That matters inside long blocks (code
 * fences, lists) where one preview anchor covers many editor lines, and
 * vice versa. Without fractions the preview would freeze in place while
 * the editor scrolled through a long code block.
 */
import type { EditorView } from '@codemirror/view';
import {
  collectPreviewAnchors,
  topLineFor,
  offsetForLine,
  type PreviewAnchor
} from './source-line';

export interface LineAdapter {
  /** Element whose `scroll` events should drive sync. */
  scrollEl: HTMLElement;
  /** Fractional source line at the top of the viewport (1-indexed). */
  topLine(): number;
  /**
   * Scroll the view so `line` lands at the top of the viewport. Accepts
   * a fractional line number — the integer part picks the line block,
   * the fractional part adds a sub-line pixel offset.
   */
  scrollToLine(line: number): void;
  /**
   * Recompute internal caches (preview anchors, parent-scroll offsets).
   * Call after content changes or images load.
   */
  refresh(): void;
}

/* ── Editor ──────────────────────────────────────────────────────────── */

/**
 * Build an editor adapter. Works for both modes:
 * - own scroll: `scrollEl === view.scrollDOM` (split view, mobile keyboard)
 * - parent scroll: `scrollEl` is an ancestor with overflow-auto; CM6's
 *   `.cm-scroller` has `overflow: visible` and the editor grows to content.
 *
 * In both cases we translate between `view.lineBlockAt(...).top` (editor
 * content coords) and `scrollEl.scrollTop` by measuring `view.contentDOM`'s
 * offset within `scrollEl` once per call. Cheap (one rect read each side)
 * and avoids stale offset bugs when the toolbar / metadata bar above the
 * editor changes height.
 *
 * Block-span resolution: in Live Preview mode CM6 collapses ranges (code
 * fences etc.) into a single replace-decoration widget — `BlockInfo.from`
 * points to the widget's first source position and `BlockInfo.length`
 * covers the whole replaced range. Without using that span the adapter
 * would treat a 30-line code block as one source line, so scrolling
 * through the widget would map every fractional position back to the
 * widget's first line and the preview side would freeze. Computing
 * `endLine` from `block.from + block.length - 1` mirrors what the preview
 * side does with `data-source-line-end`, keeping the two-way mapping
 * symmetric.
 */
export function createEditorAdapter(view: EditorView, scrollEl: HTMLElement): LineAdapter {
  function editorOffset(): number {
    const editorRect = view.contentDOM.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    return editorRect.top - scrollRect.top + scrollEl.scrollTop;
  }

  return {
    scrollEl,
    topLine() {
      const offset = editorOffset();
      const relTop = scrollEl.scrollTop - offset;
      if (relTop <= 0) return 1;
      const docHeight = view.contentDOM.getBoundingClientRect().height;
      if (relTop >= docHeight) return view.state.doc.lines;
      const block = view.lineBlockAtHeight(relTop);
      const doc = view.state.doc;
      const startLine = doc.lineAt(block.from).number;
      const endPos = Math.min(doc.length, block.from + Math.max(0, block.length - 1));
      const endLine = doc.lineAt(endPos).number;
      if (block.height <= 0) return startLine;
      const frac = (relTop - block.top) / block.height;
      const clamped = Math.max(0, Math.min(0.9999, frac));
      // For single-line blocks `endLine === startLine` — keep span=1 so the
      // fractional component still resolves wrapped sub-line positions.
      const span = endLine > startLine ? endLine - startLine : 1;
      return startLine + clamped * span;
    },
    scrollToLine(line) {
      const doc = view.state.doc;
      const intLine = Math.max(1, Math.min(Math.floor(line), doc.lines));
      const block = view.lineBlockAt(doc.line(intLine).from);
      const startLine = doc.lineAt(block.from).number;
      const endPos = Math.min(doc.length, block.from + Math.max(0, block.length - 1));
      const endLine = doc.lineAt(endPos).number;
      const span = endLine > startLine ? endLine - startLine : 1;
      const lineFrac = Math.max(0, Math.min(1, (line - startLine) / span));
      scrollEl.scrollTop = editorOffset() + block.top + lineFrac * block.height;
    },
    refresh() {
      // Editor offsets are read on demand — no cache to refresh.
    }
  };
}

/* ── Preview ─────────────────────────────────────────────────────────── */

/**
 * Build a preview adapter over a Markdown preview container.
 *
 * `contentEl` is the element that holds the rendered HTML (and bears
 * `data-source-line` markers on its descendants). `scrollEl` is the
 * actual scroll container — for split view that's `contentEl` itself,
 * for desktop single-pane parentScroll it's an ancestor.
 *
 * Anchor map (`[startLine, endLine] ↔ [top, bottom]` intervals) is rebuilt
 * on `refresh()` only, since walking ~dozens of nodes on every scroll
 * would burn frames on long notes.
 */
export function createPreviewAdapter(
  contentEl: HTMLElement,
  scrollEl: HTMLElement
): LineAdapter {
  let anchors: PreviewAnchor[] = [];

  function contentOffset(): number {
    if (contentEl === scrollEl) return 0;
    const contentRect = contentEl.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    return contentRect.top - scrollRect.top + scrollEl.scrollTop;
  }

  return {
    scrollEl,
    topLine() {
      // `relTop` is the y inside contentEl that aligns with the viewport top.
      const relTop = scrollEl.scrollTop - contentOffset();
      return topLineFor(anchors, Math.max(0, relTop));
    },
    scrollToLine(line) {
      const offset = offsetForLine(anchors, line);
      scrollEl.scrollTop = contentOffset() + offset;
    },
    refresh() {
      anchors = collectPreviewAnchors(contentEl);
    }
  };
}
