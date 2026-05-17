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
 */
export const pendingNewFolderDraft = writable<{ parentId: string | null } | null>(null);
