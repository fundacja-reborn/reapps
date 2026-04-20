import { IndexedDBStore } from '../core/store';
import type { BooleanInt, NoteStoredLocal } from '@reborn/types';
import { boolToInt, intToBool } from '../transformers/boolean';

/**
 * Storage representation: shadow-index booleans (is_pinned / is_starred /
 * is_archived) stored as `BooleanInt` (0 | 1) so IndexedDB can index them
 * efficiently. Boolean keys are not reliably indexed across browsers.
 *
 * The public type (`NoteStoredLocal`) keeps boolean fields — the transformer
 * round-trips them on save / load.
 */
type NoteStoredRaw = Omit<NoteStoredLocal, 'is_pinned' | 'is_starred' | 'is_archived'> & {
  is_pinned?: BooleanInt;
  is_starred?: BooleanInt;
  is_archived?: BooleanInt;
};

const noteTransformer = {
  toStorage: (item: NoteStoredLocal): NoteStoredRaw => {
    const result: Record<string, unknown> = { ...item };
    if (typeof item.is_pinned === 'boolean') result.is_pinned = boolToInt(item.is_pinned);
    if (typeof item.is_starred === 'boolean') result.is_starred = boolToInt(item.is_starred);
    if (typeof item.is_archived === 'boolean') result.is_archived = boolToInt(item.is_archived);
    return result as unknown as NoteStoredRaw;
  },
  fromStorage: (item: NoteStoredRaw): NoteStoredLocal => {
    const result: Record<string, unknown> = { ...item };
    // Tolerate legacy boolean values from records saved before this transformer
    // existed — only convert when the stored value is the new BooleanInt form.
    if (item.is_pinned === 0 || item.is_pinned === 1) {
      result.is_pinned = intToBool(item.is_pinned);
    }
    if (item.is_starred === 0 || item.is_starred === 1) {
      result.is_starred = intToBool(item.is_starred);
    }
    if (item.is_archived === 0 || item.is_archived === 1) {
      result.is_archived = intToBool(item.is_archived);
    }
    return result as unknown as NoteStoredLocal;
  }
};

/**
 * Note store for RebornNotes application.
 * Stores `NoteStoredRaw` (BooleanInt shadow indexes) and exposes
 * `NoteStoredLocal` (boolean shadow indexes) via the transformer.
 */
export const noteStore = new IndexedDBStore<NoteStoredRaw, NoteStoredLocal>({
  storeName: 'notes',
  indexes: [
    { name: 'folder_id', keyPath: 'folder_id' },
    { name: 'is_pinned', keyPath: 'is_pinned' },
    { name: 'is_starred', keyPath: 'is_starred' },
    { name: 'created_at', keyPath: 'created_at' },
    { name: 'updated_at', keyPath: 'updated_at' },
    { name: 'is_archived', keyPath: 'is_archived' }
  ],
  transform: noteTransformer
});

/**
 * Helper queries for notes
 */
export const noteQueries = {
  /**
   * Get all active notes (not deleted)
   */
  getActive: async (): Promise<NoteStoredLocal[]> => {
    const all = await noteStore.getAll();
    return all.filter(note => !note.is_archived);
  },

  /**
   * Get notes by folder
   */
  byFolder: async (folderId: string | null): Promise<NoteStoredLocal[]> => {
    if (folderId === null) {
      // Root level notes
      const all = await noteStore.getAll();
      return all.filter(note => !note.folder_id && !note.is_archived);
    }
    const notes = await noteStore.query('folder_id', folderId);
    return notes.filter(note => !note.is_archived);
  },

  /**
   * Get pinned notes
   */
  getPinned: async (): Promise<NoteStoredLocal[]> => {
    // IndexedDB does not support boolean keys in indexes, so we filter in memory
    const all = await noteStore.getAll();
    return all.filter(note => note.is_pinned && !note.is_archived);
  },



  /**
   * Get archived notes
   */
  getArchived: async (): Promise<NoteStoredLocal[]> => {
    // IndexedDB does not support boolean keys in indexes, so we filter in memory
    const all = await noteStore.getAll();
    return all.filter(note => note.is_archived);
  },

  /**
   * Get recently updated notes
   */
  getRecent: async (limit: number = 10): Promise<NoteStoredLocal[]> => {
    const notes = await noteQueries.getActive();
    return notes
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  }
};

/**
 * Note operations
 */
export const noteOperations = {
  /**
   * Archive a note
   */
  archive: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_archived: true,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Unarchive a note
   */
  unarchive: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_archived: false,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Toggle pin status
   */
  togglePin: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_pinned: !note.is_pinned,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Toggle star status
   */
  toggleStar: async (noteId: string): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      is_starred: !note.is_starred,
      updated_at: new Date().toISOString()
    });
  },



  /**
   * Move note to folder
   */
  moveToFolder: async (noteId: string, folderId: string | null): Promise<void> => {
    const note = await noteStore.get(noteId);
    if (!note) throw new Error('Note not found');

    await noteStore.save({
      ...note,
      folder_id: folderId ?? undefined,
      updated_at: new Date().toISOString()
    });
  },

  /**
   * Permanently delete archived notes older than specified days
   */
  cleanArchived: async (daysOld: number = 90): Promise<number> => {
    const archived = await noteQueries.getArchived();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const toDelete = archived.filter(note => {
      return new Date(note.updated_at) < cutoffDate;
    });

    await noteStore.deleteMany(toDelete.map(n => n.id));
    return toDelete.length;
  }
};
