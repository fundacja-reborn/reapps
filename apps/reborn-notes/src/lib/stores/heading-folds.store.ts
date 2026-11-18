import { writable } from 'svelte/store';

/**
 * Which sections of the open note are folded (collapsible sections, #582).
 *
 * One state for the editor and the rendered preview, so a section folded in
 * one stays folded in the other: when the view mode changes (each mode mounts
 * its own editor / preview) and in split view, where both are on screen.
 *
 * A section is named by the slug of its heading - the id the preview stamps on
 * the heading and the outline panel uses (`heading-outline.ts`). It survives
 * edits elsewhere in the note, which a line number would not.
 *
 * Memory only, for one note at a time: nothing is written to the note, to
 * settings or to localStorage, and opening another note starts unfolded.
 */
export interface HeadingFoldState {
  noteId: string | null;
  slugs: readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);

// Mirror of the store's value. A Svelte store notifies on every `set` of an
// object, even the same one, so "nothing changed" has to skip the `set`.
let held: HeadingFoldState = { noteId: null, slugs: NONE };
const state = writable<HeadingFoldState>(held);

function hold(next: HeadingFoldState): void {
  held = next;
  state.set(next);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((slug) => set.has(slug));
}

/** The folded slugs of `noteId` in `current` (none when another note is held). */
export function foldedSlugsFor(
  current: HeadingFoldState,
  noteId: string | null | undefined
): readonly string[] {
  return noteId != null && current.noteId === noteId ? current.slugs : NONE;
}

export const headingFolds = {
  subscribe: state.subscribe,

  /**
   * Replace the folded sections of `noteId`. Subscribers are not notified when
   * nothing changes, which is what stops the editor and the store from
   * answering each other forever.
   */
  set(noteId: string | null | undefined, slugs: readonly string[]): void {
    if (noteId == null) return;
    const before = foldedSlugsFor(held, noteId);
    // Same list, or nothing folded in a note that is not the held one.
    if (sameSet(before, slugs) && (held.noteId === noteId || slugs.length === 0)) return;
    hold({ noteId, slugs: [...new Set(slugs)] });
  },

  /** Forget every fold. Called when another note is opened. */
  reset(): void {
    if (held.noteId === null && held.slugs.length === 0) return;
    hold({ noteId: null, slugs: NONE });
  }
};
