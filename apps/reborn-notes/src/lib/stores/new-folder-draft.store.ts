import { flushSync } from 'svelte';
import { writable } from 'svelte/store';

/**
 * Active "new folder" draft. When non-null, the list whose parent matches
 * `parentId` (null = root) renders an inline input row at the very top,
 * pre-filled with a default name. The folder is created only on commit
 * (Enter or blur with non-empty value); Escape drops the draft.
 *
 * Placing the input at the top instead of creating the folder first solves
 * two issues with the previous create-then-rename flow: the row no longer
 * lands somewhere mid-list because of alphabetical sort, and on mobile it
 * stays above the virtual keyboard regardless of folder count.
 *
 * Open a draft with `openNewFolderDraft`, not by setting this store, so the
 * name input gets focused while the tap is still being handled.
 */
export const pendingNewFolderDraft = writable<{ parentId: string | null } | null>(null);

// The name input of the draft on screen. At most one draft exists at a time,
// and the mobile and desktop layouts never render both trees at once.
let draftInput: HTMLInputElement | null = null;

/**
 * Attachment for the draft's name input (`{@attach registerNewFolderDraftInput}`),
 * so `openNewFolderDraft` can reach the input it has just rendered.
 */
export function registerNewFolderDraftInput(node: HTMLInputElement): () => void {
  draftInput = node;
  return () => {
    if (draftInput === node) draftInput = null;
  };
}

/**
 * Open the inline new-folder draft under `parentId` (null = root) and focus
 * its name input, with the default name selected, before returning.
 *
 * Call it straight from the tap or click handler. Mobile browsers (Safari and
 * WKWebView on iOS in particular) open the virtual keyboard only for a field
 * focused while the tap is being handled. A focus from a later task, such as
 * a `setTimeout` or an effect, leaves the field without a keyboard (#511).
 * `flushSync` renders the draft row now, so the input exists to be focused.
 *
 * Not from inside an open bits-ui menu: its focus trap pulls the focus back
 * into the menu, and the input's blur then commits the default name. Let the
 * menu close first (see `FolderActionMenu`).
 */
export function openNewFolderDraft(parentId: string | null): void {
  pendingNewFolderDraft.set({ parentId });
  flushSync();
  const input = draftInput;
  if (!input) return;
  input.scrollIntoView({ block: 'nearest' });
  input.focus({ preventScroll: true });
  input.select();
}
