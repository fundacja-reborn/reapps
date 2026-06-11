import { IndexedDBStore } from '../core/store';
import type { SavedSearchEncrypted } from '@reborn/types';

/**
 * Saved searches store for the RebornNotes application.
 *
 * Records hold E2E-encrypted name + query string; the optional plaintext
 * `folder_id` "parks" a search inside the folder tree (presentational only -
 * it does not scope the query). Decryption and query parsing happen in the
 * app service layer.
 */
export const savedSearchStore = new IndexedDBStore<SavedSearchEncrypted>({
  storeName: 'savedSearches',
  indexes: [
    { name: 'folder_id', keyPath: 'folder_id' },
    { name: 'position', keyPath: 'position' }
  ]
});

/**
 * Helper queries for saved searches
 */
export const savedSearchQueries = {
  /**
   * Get saved searches parked in a specific folder, ordered by position.
   */
  getByFolder: async (folderId: string): Promise<SavedSearchEncrypted[]> => {
    const matches = await savedSearchStore.query('folder_id', folderId);
    return matches.sort((a, b) => a.position - b.position);
  },

  /**
   * Get all saved searches ordered by position. Name-based tie-breaking
   * happens in the service layer after decryption.
   */
  getAllOrdered: async (): Promise<SavedSearchEncrypted[]> => {
    const all = await savedSearchStore.getAll();
    return all.sort((a, b) => a.position - b.position);
  },

  /**
   * Next free position (append semantics for newly created searches).
   */
  getNextPosition: async (): Promise<number> => {
    const all = await savedSearchStore.getAll();
    if (all.length === 0) return 0;
    return Math.max(...all.map((s) => s.position)) + 1;
  }
};
