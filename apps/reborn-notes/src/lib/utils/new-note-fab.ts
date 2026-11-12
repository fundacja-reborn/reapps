import { PLACE_SECTIONS } from '$lib/stores/start-place';

/**
 * When the phone layout shows the floating "New note" button (issue #541).
 *
 * Only in the browsing sections (All notes, Starred, Folders, Tags - the same
 * set a start page can be): Trash, Search and Shares are detours where a new
 * note makes no sense, and a periodic section creates its own notes. It also
 * steps aside while notes are being selected (the bulk actions own the screen)
 * and while a field in the list panel has focus, so it never floats over the
 * text being typed when the keyboard resizes the view.
 */
export function showNewNoteFab(state: {
  /** The per-device preference (Settings > Behavior). */
  enabled: boolean;
  /** The active rail section. */
  section: string;
  /** Multi-select is on in the note list. */
  selectionActive: boolean;
  /** A text field in the list panel has focus. */
  typing: boolean;
}): boolean {
  if (!state.enabled || state.selectionActive || state.typing) return false;
  return (PLACE_SECTIONS as readonly string[]).includes(state.section);
}

/** True for an element the on-screen keyboard opens for. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'color', 'file', 'radio', 'range', 'reset', 'submit'].includes(
      target.type
    );
  }
  // `=== true`: jsdom leaves the property undefined.
  return target.isContentEditable === true;
}
