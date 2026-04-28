/**
 * Scroll-sync helper for split view (editor ↔ preview).
 *
 * Strategy: soft sync (post-gesture). Each pane stamps `lastUserScroll` on its
 * own scroll event; the cross-pane sync only runs after a short pause (≥ 80 ms)
 * when no fresh user input is arriving. This eliminates the iOS Safari ping-pong
 * caused by momentum scrolling, where every frame triggered a programmatic
 * counter-scroll on the other pane and asymmetric ratio drift pulled both panes
 * toward scrollTop=0.
 *
 * Usage in a Svelte component:
 *   const scrollSync = createScrollSync();
 *   // pass scrollSync.initEditorScroller to NoteEditor's onscrollerinit
 *   // bind:scrollEl={scrollSync.previewScrollEl} on MarkdownPreview
 *   // call scrollSync.setScrollContainer(el) when editor uses parentScroll
 *   // call scrollSync.destroy() on cleanup
 */

export interface ScrollSync {
  /** Bind this to MarkdownPreview's scrollEl */
  previewScrollEl: HTMLElement | null;
  /** Pass this as NoteEditor's onscrollerinit callback */
  initEditorScroller: (el: HTMLElement) => void;
  /**
   * Override the scroll source with a parent scroll container.
   * Used when the editor is in parentScroll mode (.cm-scroller has overflow:visible).
   * Pass null to revert to the CM scroller.
   */
  setScrollContainer: (el: HTMLElement | null) => void;
  /** Sync preview → editor (attach as scroll listener on preview) */
  syncPreviewToEditor: () => void;
  /** Clean up all scroll listeners */
  destroy: () => void;
}

const USER_SCROLL_QUIET_MS = 80;
const SYNC_RELEASE_MS = 120;

export function createScrollSync(): ScrollSync {
  let editorScroller: HTMLElement | null = null;
  let scrollContainer: HTMLElement | null = null;
  let syncing = false;
  let lastUserScroll = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let editorPendingTimer: ReturnType<typeof setTimeout> | null = null;
  let previewPendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** The element whose scroll position drives editor→preview sync. */
  function activeSource(): HTMLElement | null {
    return scrollContainer ?? editorScroller;
  }

  function scheduleRelease() {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      syncing = false;
      releaseTimer = null;
    }, SYNC_RELEASE_MS);
  }

  function applyRatio(target: HTMLElement, ratio: number) {
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  }

  function syncEditorToPreviewNow() {
    const source = activeSource();
    if (!source || !sync.previewScrollEl) return;
    syncing = true;
    const { scrollTop, scrollHeight, clientHeight } = source;
    const ratio = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
    applyRatio(sync.previewScrollEl, ratio);
    scheduleRelease();
  }

  function syncPreviewToEditorNow() {
    const target = activeSource();
    if (!target || !sync.previewScrollEl) return;
    syncing = true;
    const { scrollTop, scrollHeight, clientHeight } = sync.previewScrollEl;
    const ratio = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
    applyRatio(target, ratio);
    scheduleRelease();
  }

  function syncEditorToPreview() {
    if (syncing) return;
    lastUserScroll = performance.now();
    if (editorPendingTimer) clearTimeout(editorPendingTimer);
    editorPendingTimer = setTimeout(() => {
      editorPendingTimer = null;
      // Only run if no newer user-driven scroll arrived in the meantime
      if (performance.now() - lastUserScroll >= USER_SCROLL_QUIET_MS - 1) {
        syncEditorToPreviewNow();
      }
    }, USER_SCROLL_QUIET_MS);
  }

  function syncPreviewToEditor() {
    if (syncing) return;
    lastUserScroll = performance.now();
    if (previewPendingTimer) clearTimeout(previewPendingTimer);
    previewPendingTimer = setTimeout(() => {
      previewPendingTimer = null;
      if (performance.now() - lastUserScroll >= USER_SCROLL_QUIET_MS - 1) {
        syncPreviewToEditorNow();
      }
    }, USER_SCROLL_QUIET_MS);
  }

  function initEditorScroller(el: HTMLElement) {
    editorScroller = el;
    // Only listen on CM scroller when no container override is active
    if (!scrollContainer) {
      el.addEventListener('scroll', syncEditorToPreview, { passive: true });
    }
  }

  function setScrollContainer(el: HTMLElement | null) {
    // Remove previous container listener
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', syncEditorToPreview);
    }

    // If switching away from CM scroller, stop listening there
    if (!scrollContainer && editorScroller) {
      editorScroller.removeEventListener('scroll', syncEditorToPreview);
    }

    scrollContainer = el;

    if (el) {
      el.addEventListener('scroll', syncEditorToPreview, { passive: true });
    } else if (editorScroller) {
      // Revert to CM scroller
      editorScroller.addEventListener('scroll', syncEditorToPreview, { passive: true });
    }
  }

  function destroy() {
    if (releaseTimer) clearTimeout(releaseTimer);
    if (editorPendingTimer) clearTimeout(editorPendingTimer);
    if (previewPendingTimer) clearTimeout(previewPendingTimer);
    releaseTimer = null;
    editorPendingTimer = null;
    previewPendingTimer = null;
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', syncEditorToPreview);
      scrollContainer = null;
    }
    if (editorScroller) {
      editorScroller.removeEventListener('scroll', syncEditorToPreview);
      editorScroller = null;
    }
  }

  const sync: ScrollSync = {
    previewScrollEl: null,
    initEditorScroller,
    setScrollContainer,
    syncPreviewToEditor,
    destroy
  };

  return sync;
}
