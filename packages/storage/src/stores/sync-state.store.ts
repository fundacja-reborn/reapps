import { IndexedDBStore } from '../core/store';
import type { SyncState as BaseSyncState } from '@reborn/types';

/**
 * Extended sync state with additional fields for tracking sync progress
 */
export interface SyncState extends BaseSyncState {
  sync_in_progress?: boolean;
  sync_error?: string | null;
  updated_at?: string;
}

/**
 * Sync state store for tracking synchronization status
 */
export const syncStateStore = new IndexedDBStore<SyncState>({
  storeName: 'syncState',
  indexes: []
});

/**
 * Helper queries for sync state
 */
export const syncStateQueries = {
  /**
   * Get current sync state
   */
  getCurrentState: async (): Promise<SyncState | null> => {
    const states = await syncStateStore.getAll();
    return states[0] || null;
  },

  /**
   * Check if we have sync state
   */
  hasState: async (): Promise<boolean> => {
    const count = await syncStateStore.count();
    return count > 0;
  },

  /**
   * Get last sync timestamp
   */
  getLastSyncTime: async (): Promise<string | null> => {
    const state = await syncStateQueries.getCurrentState();
    return state?.lastSyncTimestamp ? new Date(state.lastSyncTimestamp).toISOString() : null;
  }
};

/**
 * Sync state operations
 */
export const syncStateOperations = {
  /**
   * Update sync state
   */
  updateState: async (state: Partial<SyncState>): Promise<void> => {
    const currentState = await syncStateQueries.getCurrentState();
    const newState: SyncState = {
      id: currentState?.id || crypto.randomUUID(),
      lastSyncTimestamp: Date.now(),
      version: currentState?.version || 1,
      sync_in_progress: false,
      sync_error: null,
      ...currentState,
      ...state,
      updated_at: new Date().toISOString()
    };
    await syncStateStore.save(newState);
  },

  /**
   * Mark sync as started
   */
  startSync: async (): Promise<void> => {
    await syncStateOperations.updateState({
      sync_in_progress: true,
      sync_error: null
    });
  },

  /**
   * Mark sync as completed
   */
  completeSync: async (): Promise<void> => {
    await syncStateOperations.updateState({
      sync_in_progress: false,
      sync_error: null,
      lastSyncTimestamp: Date.now()
    });
  },

  /**
   * Mark sync as failed
   */
  failSync: async (error: string): Promise<void> => {
    await syncStateOperations.updateState({
      sync_in_progress: false,
      sync_error: error
    });
  },

  /**
   * Clear sync state
   */
  clearState: async (): Promise<void> => {
    await syncStateStore.clear();
  }
};
