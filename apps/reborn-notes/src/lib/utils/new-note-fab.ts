/**
 * Sections whose list a new note lands in: All notes, and Folders (the tree
 * and an open folder). Starred and Tags are left out on purpose: a new note
 * has no star and no tag, so "New note" has to leave those views for All
 * notes, and on the tag list a second "+" reads as "add a tag". The rail's
 * button still creates a note from anywhere.
 */
export const NEW_NOTE_FAB_SECTIONS = ['all', 'folders'] as const;

/**
 * When the phone layout shows the floating "New note" button (issue #541).
 *
 * Only in {@link NEW_NOTE_FAB_SECTIONS}. It also steps aside while notes are
 * being selected (the bulk actions own the screen) and while a field in the
 * list panel has focus, so it never floats over the text being typed when the
 * keyboard resizes the view.
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
  return (NEW_NOTE_FAB_SECTIONS as readonly string[]).includes(state.section);
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
