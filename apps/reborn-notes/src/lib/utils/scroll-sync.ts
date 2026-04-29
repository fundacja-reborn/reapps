/**
 * Line-anchored scroll sync between editor and preview.
 *
 * Two roles in one primitive:
 *
 * 1. **Toggle preservation** (single-pane): when user switches between Edit
 *    and Preview (or Live ↔ Markdown), the new view scrolls so the same
 *    *source line* sits at the top of the viewport. `anchorLine` is updated
 *    on every scroll of whichever pane is currently mounted; on remount the
 *    new pane reads it back via `restoreTo()`.
 *
 * 2. **Split view** (both panes mounted): scroll in either pane drives
 *    the other to the same source line on every scroll event (no timer,
 *    no rAF gating). Cross-pane echo events are dropped via deterministic
 *    expected-scrollTop matching — robust to background-tab rAF
 *    throttling and scrolls that don't actually move the target pane.
 *    The line-based math is exact regardless of pane height asymmetry —
 *    no more ratio drift toward scrollTop=0.
 *
 * Adapters are set/cleared as panes mount and unmount. `null` means "this
 * pane isn't mounted right now"; sync to the other side becomes a no-op.
 */
import type { LineAdapter } from './line-adapter';

export interface ScrollSync {
  /** Last-known top-of-viewport line. Persists across pane remounts. */
  readonly anchorLine: number;
  /** Set/clear adapters as panes mount/unmount. */
  setEditor(adapter: LineAdapter | null): void;
  setPreview(adapter: LineAdapter | null): void;
  /** Scroll the named pane to `anchorLine` (use after a pane (re)mounts). */
  restoreTo(target: 'editor' | 'preview'): void;
  /** Read the current top line of the named pane and store as anchor. */
  captureFrom(source: 'editor' | 'preview'): void;
  /**
   * Force the anchor to a specific line — used when navigating to a new
   * note so position from the previous note doesn't carry over.
   */
  setAnchor(line: number): void;
  /** Tell adapters to rebuild their internal caches (e.g. preview anchors). */
  refresh(): void;
  /** Drop listeners and timers. */
  destroy(): void;
}

export function createScrollSync(): ScrollSync {
  let editor: LineAdapter | null = null;
  let preview: LineAdapter | null = null;
  let editorCleanup: (() => void) | null = null;
  let previewCleanup: (() => void) | null = null;

  let anchorLine = 1;
  /**
   * `pristine` = "no real user scroll has ever updated the anchor on this
   * note". While pristine, `restoreTo()` no-ops — otherwise the queued
   * micro-task on initial editor mount would snap a freshly-opened note
   * back to scrollTop=0 *after* the user's first wheel tick has already
   * moved them, which felt like the editor refused to scroll.
   */
  let pristine = true;
  /**
   * Echo suppression: when we programmatically scroll a pane, we record
   * the resulting scrollTop here. The pane's own scroll handler then
   * matches that value and skips one event without locking sync for any
   * fixed time window. Robust to background-tab rAF throttling and to
   * scrolls that don't actually move the pane (programmatic set was a
   * no-op → no echo, expected reset is harmless because the next *real*
   * scroll won't match the stored value).
   */
  let expectedEditorScrollTop: number | null = null;
  let expectedPreviewScrollTop: number | null = null;

  /** Capture the active pane's top line into the anchor. Cheap. */
  function captureFromActive(source: 'editor' | 'preview') {
    const a = source === 'editor' ? editor : preview;
    if (!a) return;
    anchorLine = a.topLine();
    pristine = false;
  }

  function isEcho(adapter: LineAdapter, expected: number | null): boolean {
    if (expected === null) return false;
    // <1px tolerance: browsers can round subpixel scrollTop values.
    return Math.abs(adapter.scrollEl.scrollTop - expected) < 1;
  }

  function onEditorScroll() {
    if (editor && isEcho(editor, expectedEditorScrollTop)) {
      expectedEditorScrollTop = null;
      return;
    }
    expectedEditorScrollTop = null;
    captureFromActive('editor');
    if (preview) {
      const before = preview.scrollEl.scrollTop;
      preview.scrollToLine(anchorLine);
      const after = preview.scrollEl.scrollTop;
      // Only arm echo guard if the programmatic set actually moved the
      // scroll — otherwise the next *real* preview scroll would be eaten.
      expectedPreviewScrollTop = after !== before ? after : null;
    }
  }

  function onPreviewScroll() {
    if (preview && isEcho(preview, expectedPreviewScrollTop)) {
      expectedPreviewScrollTop = null;
      return;
    }
    expectedPreviewScrollTop = null;
    captureFromActive('preview');
    if (editor) {
      const before = editor.scrollEl.scrollTop;
      editor.scrollToLine(anchorLine);
      const after = editor.scrollEl.scrollTop;
      expectedEditorScrollTop = after !== before ? after : null;
    }
  }

  function attach(adapter: LineAdapter, handler: () => void): () => void {
    adapter.scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => adapter.scrollEl.removeEventListener('scroll', handler);
  }

  return {
    get anchorLine() {
      return anchorLine;
    },

    setEditor(adapter) {
      if (editorCleanup) {
        editorCleanup();
        editorCleanup = null;
      }
      editor = adapter;
      if (adapter) {
        adapter.refresh();
        // Pre-restore BEFORE attaching the scroll listener. On Preview →
        // Edit toggle, the parent scrollHeight briefly shrinks (raw / live
        // markdown is shorter than rendered HTML) and the browser auto-
        // clamps scrollTop, queuing a synthetic scroll event. If the
        // listener were attached first, that event would call
        // captureFromActive('editor') with the clamped (≈ 0) position,
        // stomping the anchor that Preview captured before the toggle.
        // Restoring first puts scrollTop in range; the clamp event (and
        // the event from our own scrollTop write) match expectedEditor-
        // ScrollTop via the existing isEcho guard. The deferred post-
        // measure restoreTo() in the caller still runs for height-
        // accurate refinement once CM6's height map is populated.
        if (!pristine) {
          const before = adapter.scrollEl.scrollTop;
          adapter.scrollToLine(anchorLine);
          const after = adapter.scrollEl.scrollTop;
          if (after !== before) expectedEditorScrollTop = after;
        }
        editorCleanup = attach(adapter, onEditorScroll);
      }
    },

    setPreview(adapter) {
      if (previewCleanup) {
        previewCleanup();
        previewCleanup = null;
      }
      preview = adapter;
      if (adapter) {
        adapter.refresh();
        // Symmetric pre-restore. Edit → Preview generally doesn't trigger
        // an auto-clamp (rendered HTML is taller than raw markdown), but
        // long source with a short rendering (e.g., a tall code fence
        // collapsing into a syntax-highlighted block) can — same fix.
        if (!pristine) {
          const before = adapter.scrollEl.scrollTop;
          adapter.scrollToLine(anchorLine);
          const after = adapter.scrollEl.scrollTop;
          if (after !== before) expectedPreviewScrollTop = after;
        }
        previewCleanup = attach(adapter, onPreviewScroll);
      }
    },

    restoreTo(target) {
      // No-op until a real user scroll has primed the anchor. Without this,
      // the queued restore on initial editor mount would scroll a fresh
      // note (anchor=1) back to scrollTop=0 — fine *intent* on first paint,
      // but the micro-task fires after the user's first wheel tick has
      // already moved them, looking like the editor refused to scroll.
      if (pristine) return;
      const a = target === 'editor' ? editor : preview;
      if (!a) return;
      const before = a.scrollEl.scrollTop;
      a.scrollToLine(anchorLine);
      const after = a.scrollEl.scrollTop;
      if (after !== before) {
        if (target === 'editor') expectedEditorScrollTop = after;
        else expectedPreviewScrollTop = after;
      }
    },

    captureFrom(source) {
      captureFromActive(source);
    },

    setAnchor(line) {
      // Keep fractional resolution — the anchor flows back into
      // `scrollToLine`, which interpolates sub-line pixel offsets.
      anchorLine = Math.max(1, line);
      // Note open / explicit reset → forget any captured state. The next
      // `restoreTo` will no-op until the user actually scrolls.
      pristine = true;
    },

    refresh() {
      editor?.refresh();
      preview?.refresh();
    },

    destroy() {
      editorCleanup?.();
      previewCleanup?.();
      editorCleanup = null;
      previewCleanup = null;
      editor = null;
      preview = null;
      expectedEditorScrollTop = null;
      expectedPreviewScrollTop = null;
    }
  };
}
