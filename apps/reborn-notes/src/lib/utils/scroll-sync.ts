/**
 * Scroll-sync helper for split view (editor ↔ preview).
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

export function createScrollSync(): ScrollSync {
  let editorScroller: HTMLElement | null = null;
  let scrollContainer: HTMLElement | null = null;
  let syncing = false;

  /** The element whose scroll position drives sync. */
  function activeSource(): HTMLElement | null {
    return scrollContainer ?? editorScroller;
  }

  function syncEditorToPreview() {
    const source = activeSource();
    if (syncing || !source || !sync.previewScrollEl) return;
    syncing = true;
    const { scrollTop, scrollHeight, clientHeight } = source;
    const ratio = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
    sync.previewScrollEl.scrollTop =
      ratio * (sync.previewScrollEl.scrollHeight - sync.previewScrollEl.clientHeight);
    requestAnimationFrame(() => {
      syncing = false;
    });
  }

  function syncPreviewToEditor() {
    const target = activeSource();
    if (syncing || !target || !sync.previewScrollEl) return;
    syncing = true;
    const { scrollTop, scrollHeight, clientHeight } = sync.previewScrollEl;
    const ratio = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    requestAnimationFrame(() => {
      syncing = false;
    });
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
