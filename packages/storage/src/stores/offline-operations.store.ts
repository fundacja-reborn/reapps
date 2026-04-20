import { IndexedDBStore } from '../core/store';
import type { StorageOfflineOperation } from '@reborn/types';

// Create the store instance for offline operations
export const offlineOperationsStore = new IndexedDBStore<StorageOfflineOperation>({
  storeName: 'offlineOperations',
  indexes: [
    { name: 'entityType', keyPath: 'entityType' },
    { name: 'status', keyPath: 'status' },
    { name: 'timestamp', keyPath: 'timestamp' }
  ]
});

// Export convenience methods
export const offlineOperationQueries = {
  /**
   * Get all pending operations
   */
  async getPending(): Promise<StorageOfflineOperation[]> {
    const all = await offlineOperationsStore.getAll();
    return all.filter(op => op.status === 'pending' || !op.status);
  },

  /**
   * Get operations by entity type
   */
  async byEntityType(entityType: string): Promise<StorageOfflineOperation[]> {
    return offlineOperationsStore.query('entityType', entityType);
  },

  /**
   * Get operations by status
   */
  async byStatus(status: string): Promise<StorageOfflineOperation[]> {
    return offlineOperationsStore.query('status', status);
  }
};

// Export batch operations
export const offlineOperationBatchOps = {
  /**
   * Clear all failed operations
   */
  async clearFailed(): Promise<void> {
    const all = await offlineOperationsStore.getAll();
    const failed = all.filter(op => op.status === 'failed');
    for (const op of failed) {
      await offlineOperationsStore.delete(op.id);
    }
  },

  /**
   * Clear all operations
   */
  async clearAll(): Promise<void> {
    await offlineOperationsStore.clear();
  }
};

/**
 * Add a new offline operation (create/update/delete for task, list, etc.)
 * Ustawia status 'pending', timestamp, generuje id jeśli brak.
 */
export async function addOperation(params: {
  type: StorageOfflineOperation['type'];
  entityType: StorageOfflineOperation['entityType'];
  entityId: string;
  data: unknown;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const operation: StorageOfflineOperation = {
    id,
    type: params.type,
    entityType: params.entityType,
    entityId: params.entityId,
    data: params.data,
    status: 'pending',
    timestamp: now,
    // wymagane przez ExtendedOfflineOperation/OfflineOperation
    operation: params.type, // synchronizuj z type
    createdAt: new Date(now).toISOString()
  };
  await offlineOperationsStore.save(operation);
  return id;
}
