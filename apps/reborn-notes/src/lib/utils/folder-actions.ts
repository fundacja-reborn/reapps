import {
  Archive,
  ArrowDown,
  ArrowUp,
  CornerUpRight,
  FilePlus,
  FolderInput,
  FolderPlus,
  Palette,
  Pencil,
  RefreshCw,
  Trash2,
  Upload
} from '@lucide/svelte';
import type { FolderWithChildren } from '@reborn/types';
import type { RowAction } from './row-action';

/**
 * What each folder action does on the surface that shows the menu. A handler
 * left out hides its item, so a surface offers only what it can carry out
 * (no sibling order to nudge in the folder header, for example).
 */
export interface FolderActionHandlers {
  /** Only offered for a folder that is a sync destination (`syncConfigId`). */
  syncNow: (e?: Event) => void;
  newNote?: (e?: Event) => void;
  newSubfolder?: (e?: Event) => void;
  rename: (e?: Event) => void;
  appearance: (e?: Event) => void;
  move: (e?: Event) => void;
  /** Custom sort only: swap with the neighbour above / below. */
  moveUp?: (e?: Event) => void;
  moveDown?: (e?: Event) => void;
  importFiles: (e?: Event) => void;
  importFolder: (e?: Event) => void;
  archive: (e?: Event) => void;
  remove: (e?: Event) => void;
}

export interface FolderActionOptions {
  /** The current translator (`$t`), so labels follow a language switch. */
  t: (key: string) => string;
  /** Folder sync config linked to this folder, if any. */
  syncConfigId?: string | null;
  /**
   * Menu for a folder whose name could not be decrypted. The name is a
   * folder's only ciphertext and a rename re-encrypts it under the current
   * key, so a row offers just the repair (Rename) and Delete. The header of
   * the folder being browsed keeps the working items (`'full'`): on a narrow
   * phone its menu is the only place with "New note here" / "New subfolder".
   * Color and icon and Archive are hidden either way.
   */
  undecryptable?: 'repair-only' | 'full';
}

/**
 * The folder menu: one list for every place a folder shows one (tree row,
 * subfolder row in the main panel, header of the open folder), in every form
 * (kebab dropdown, right-click menu, phone sheet). Add, remove or reorder an
 * action here and all of them follow.
 */
export function buildFolderActions(
  folder: Pick<FolderWithChildren, 'decrypt_failed'>,
  handlers: FolderActionHandlers,
  { t, syncConfigId = null, undecryptable = 'repair-only' }: FolderActionOptions
): RowAction[] {
  const failed = !!folder.decrypt_failed;
  const actions: RowAction[] = [];
  // Groups are divided by a separator carried by the first item that actually
  // renders after the divide, so a hidden item never leaves a stray line.
  let divide = false;
  const add = (
    key: string,
    icon: RowAction['icon'],
    labelKey: string,
    run: ((e?: Event) => void) | undefined,
    destructive = false
  ) => {
    if (!run) return;
    const action: RowAction = { key, icon, label: t(labelKey), run };
    if (destructive) action.destructive = true;
    if (divide && actions.length > 0) action.separatorBefore = true;
    divide = false;
    actions.push(action);
  };

  if (failed && undecryptable === 'repair-only') {
    add('rename', Pencil, 'folders.rename', handlers.rename);
    divide = true;
    add('delete', Trash2, 'folders.delete_folder', handlers.remove, true);
    return actions;
  }

  if (syncConfigId) {
    add('sync', RefreshCw, 'folders.sync_now', handlers.syncNow);
    divide = true;
  }
  add('new-note', FilePlus, 'folders.new_note_here', handlers.newNote);
  add('new-subfolder', FolderPlus, 'folders.new_subfolder', handlers.newSubfolder);
  add('rename', Pencil, 'folders.rename', handlers.rename);
  if (!failed) add('appearance', Palette, 'folders.appearance.action', handlers.appearance);
  add('move', CornerUpRight, 'folders.move_to', handlers.move);
  add('move-up', ArrowUp, 'folders.move_up', handlers.moveUp);
  add('move-down', ArrowDown, 'folders.move_down', handlers.moveDown);
  add('import-md', Upload, 'folders.import_markdown.action', handlers.importFiles);
  add('import-folder', FolderInput, 'folders.import_folder.action', handlers.importFolder);
  divide = true;
  if (!failed) add('archive', Archive, 'archive.folder_action', handlers.archive);
  add('delete', Trash2, 'folders.delete_folder', handlers.remove, true);
  return actions;
}
