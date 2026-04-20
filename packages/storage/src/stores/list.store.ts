import { IndexedDBStore } from '../core/store';
import type { ListEncrypted } from '@reborn/types';

/**
 * TaskList store - no boolean transformation needed as is_default stays as boolean
 */
export const listStore = new IndexedDBStore<ListEncrypted>({
  storeName: 'taskLists',
  indexes: [
    { name: 'user_id', keyPath: 'user_id' },
    { name: 'is_default', keyPath: 'is_default' },
    { name: 'order_index', keyPath: 'order_index' }
  ]
});

/**
 * Helper queries for task lists
 */
export const listQueries = {
  /**
   * Get all lists for a user
   */
  byUser: (userId: string) => 
    listStore.query('user_id', userId),
  

  
  /**
   * Get the default list
   */
  getDefault: async (userId?: string) => {
    // IndexedDB does not support boolean keys in indexes, so we filter in memory
    const all = await listStore.getAll();
    const lists = all.filter(list => list.is_default);
    return userId 
      ? lists.find(list => list.user_id === userId) || null
      : lists[0] || null;
  },
  
  /**
   * Get lists ordered by order_index
   */
  ordered: async (userId?: string) => {
    const lists = userId 
      ? await listQueries.byUser(userId)
      : await listStore.getAll();
    return lists.sort((a, b) => a.order_index - b.order_index);
  }
};

/**
 * Delete operations for lists
 * Note: Operations that involve tasks should be handled by the application layer
 * to avoid circular dependencies between stores
 */
export const listDeleteOps = {
  /**
   * Hard delete a list (permanently remove)
   * Note: The application layer should handle task deletion/migration
   */
  hardDelete: async (listId: string) => {
    await listStore.delete(listId);
  }
};

/**
 * Batch operations for lists
 */
export const listBatchOps = {
  
  /**
   * Set a new default list
   */
  setDefault: async (listId: string, userId: string) => {
    // First, unset any existing default
    const currentDefault = await listQueries.getDefault(userId);
    if (currentDefault && currentDefault.id !== listId) {
      await listStore.save({
        ...currentDefault,
        is_default: false,
        updated_at: new Date().toISOString()
      });
    }
    
    // Then set the new default
    const list = await listStore.get(listId);
    if (list) {
      await listStore.save({
        ...list,
        is_default: true,
        updated_at: new Date().toISOString()
      });
    }
  },
  
  /**
   * Reorder lists
   */
  reorder: async (listIds: string[]) => {
    const lists = await listStore.getMany(listIds);
    const updatedLists = lists.map((list, index) => ({
      ...list,
      order_index: index,
      updated_at: new Date().toISOString()
    }));
    return listStore.saveMany(updatedLists);
  }
};
