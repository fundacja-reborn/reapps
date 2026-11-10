/**
 * Shared open-state for the note color dialog (`NoteColorDialog`), mounted
 * once on the main page. Opened from the note row menus, the mobile note
 * sheet, the open note's menu and metadata row, and the multi-select bar -
 * for one note or a whole selection.
 */
export const noteColorDialog = $state<{ open: boolean; noteIds: string[] }>({
  open: false,
  noteIds: []
});

export function openNoteColorDialog(noteIds: string[]): void {
  if (noteIds.length === 0) return;
  noteColorDialog.noteIds = [...noteIds];
  noteColorDialog.open = true;
}
