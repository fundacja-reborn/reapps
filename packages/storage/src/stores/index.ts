// Export base configuration
export * from './base.store';

// Task management stores
export * from './task.store';
export * from './list.store';
export * from './subtask.store';

// Notes app stores
export * from './note.store';
export * from './folder.store';
export * from './tag.store';
export * from './saved-search.store';
export * from './note-tag.store';
export * from './note-history.store';
export * from './folder-sync.store';

// Common stores
export * from './user.store';
export * from './sync-state.store';
export * from './settings.store';
export * from './offline-operations.store';

// Re-export stores and utilities for convenience
// Task management
export { taskStore, taskQueries, taskBatchOps } from './task.store';
export { listStore, listQueries, listDeleteOps, listBatchOps } from './list.store';
export { subtaskStore, subtaskQueries } from './subtask.store';

// Notes app
export { noteStore, noteQueries, noteOperations } from './note.store';
export { folderStore, folderQueries, folderOperations } from './folder.store';
export { tagStore, tagQueries, tagOperations } from './tag.store';
export { savedSearchStore, savedSearchQueries } from './saved-search.store';
export { noteTagStore, noteTagQueries, noteTagOperations } from './note-tag.store';
export { noteHistoryStore, noteHistoryQueries, noteHistoryOperations } from './note-history.store';
export { folderSyncStore } from './folder-sync.store';
export type { FolderSyncConfigRecord } from './folder-sync.store';

// Export the extended NoteTag type from note-tag.store
export type { NoteTag } from './note-tag.store';

// Common
export { userStore, userQueries, userOperations } from './user.store';
export { syncStateStore, syncStateQueries, syncStateOperations } from './sync-state.store';
export { settingsStore, settingsQueries, settingsOperations } from './settings.store';
export { offlineOperationsStore, offlineOperationQueries, offlineOperationBatchOps, addOperation } from './offline-operations.store';
