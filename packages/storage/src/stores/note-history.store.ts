import { IndexedDBStore } from '../core/store';
import { MAX_NOTE_VERSIONS, type NoteHistoryEntry } from '@reborn/types';

export const noteHistoryStore = new IndexedDBStore<NoteHistoryEntry>({
  storeName: 'noteHistory',
  indexes: [
    { name: 'note_id', keyPath: 'note_id' },
    { name: 'created_at', keyPath: 'created_at' }
  ]
});

/** Helper queries for note history. */
export const noteHistoryQueries = {
  /** Get all versions for a note, newest first. */
  getForNote: async (noteId: string): Promise<NoteHistoryEntry[]> => {
    const all = await noteHistoryStore.query('note_id', noteId);
    return all.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
};

/** History operations. */
export const noteHistoryOperations = {
  /** Save a new version snapshot for a note. */
  saveVersion: async (entry: Omit<NoteHistoryEntry, 'id'>): Promise<string> => {
    const id = crypto.randomUUID();
    await noteHistoryStore.save({ id, ...entry });
    return id;
  },

  /** Delete all history for a note (e.g. when note is permanently deleted). */
  deleteAllForNote: async (noteId: string): Promise<void> => {
    const entries = await noteHistoryQueries.getForNote(noteId);
    if (entries.length > 0) {
      await noteHistoryStore.deleteMany(entries.map((e) => e.id));
    }
  },

  /** Keep only the most recent N versions per note, delete the rest. */
  pruneVersions: async (noteId: string, keepCount = MAX_NOTE_VERSIONS): Promise<void> => {
    const versions = await noteHistoryQueries.getForNote(noteId);
    if (versions.length > keepCount) {
      const toDelete = versions.slice(keepCount).map((v) => v.id);
      await noteHistoryStore.deleteMany(toDelete);
    }
  }
};
