/**
 * Which folder a note made with "New note" goes to (#522).
 *
 * - A folder is open: that folder, as before.
 * - The top of the folder tree is open (the notes without a folder): no folder,
 *   so the new note shows up where the user is looking.
 * - Anything else (All notes, Starred, Tags, a smart folder, search): the
 *   folder chosen in Settings > Behavior, if it still exists; otherwise no folder.
 *
 * `undefined` means "no folder of our own": `notesStore.create` then uses its
 * current scope, which in all of those views is "no folder".
 */
export function resolveNewNoteFolder(
  openFolderId: string | null | undefined,
  preferredFolderId: string | null,
  folderExists: (id: string) => boolean
): string | undefined {
  if (typeof openFolderId === 'string') return openFolderId;
  if (openFolderId === null) return undefined;
  if (preferredFolderId !== null && folderExists(preferredFolderId)) return preferredFolderId;
  return undefined;
}
