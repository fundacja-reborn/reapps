import { IndexedDBStore } from '../core/store';
// eslint-disable-next-line @nx/enforce-module-boundaries -- reachable via the lazy ./stores barrel; the static @reborn/types value import (MAX_NOTE_VERSIONS) is intentional
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

  /**
   * Delete a note's versions except `keepId` (user "Clear history", #521).
   * Returns the removed entries so a caller can put them back if the matching
   * server delete fails.
   */
  clearForNote: async (noteId: string, keepId?: string): Promise<NoteHistoryEntry[]> => {
    const entries = await noteHistoryQueries.getForNote(noteId);
    const removed = entries.filter((e) => e.id !== keepId);
    if (removed.length > 0) {
      await noteHistoryStore.deleteMany(removed.map((e) => e.id));
    }
    return removed;
  },

  /**
   * Delete one version (#521). Returns the removed entry (null if it was
   * already gone) so a caller can put it back if the server delete fails.
   */
  deleteVersion: async (id: string): Promise<NoteHistoryEntry | null> => {
    const entry = await noteHistoryStore.get(id);
    if (entry) await noteHistoryStore.delete(id);
    return entry;
  },

  /** Delete the version history of every note on this device (#521). */
  clearAll: async (): Promise<void> => {
    await noteHistoryStore.clear();
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
