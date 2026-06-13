import { createLogger } from '@reborn/utils';

/**
 * @reborn/storage - Offline-first storage solution for Reborn Apps
 *
 * This package provides a clean, type-safe API for IndexedDB storage
 * with automatic boolean to integer transformation for efficient indexing.
 */

// Core exports
export {
  databaseManager,
  initDatabase,
  closeDatabase,
  getDatabase,
  isDatabaseInitialized
} from './core/database';
export type { StoreDefinition } from './core/database';
export { IndexedDBStore } from './core/store';
export type { StoreConfig, IndexConfig, QueryOptions, BatchResult, WithId } from './core/types';

// Transformer exports
export {
  boolToInt,
  intToBool,
  createBooleanTransformer,
  createNestedBooleanTransformer,
  combineTransformers
} from './transformers/boolean';

// Store exports
// Re-export all stores and utilities
export * from './stores';

// Export AppSettings type for app usage
export type {
  AppSettings,
  ImageLoadMode,
  EditorMode,
  PeriodicKind,
  PeriodicKindSettings,
  PeriodicNotesSettings
} from './stores/settings.store';
export {
  PERIODIC_NOTES_DEFAULTS,
  PERIODIC_NOTES_DEFAULT_FORMATS
} from './stores/settings.store';

// E2E synced user settings — pull/push service + bundle utilities
export {
  SyncedSettingsService,
  createSyncedSettingsService
} from './services/synced-settings.service';
export type { SyncedSettingsAdapter } from './services/synced-settings.service';
export {
  SCOPE_SHARED,
  SETTINGS_BUNDLE_SCHEMA_VERSION,
  appScopeFor,
  extractSharedBundle,
  extractAppBundle,
  applyBundlesToSettings,
  migrateSharedBundle,
  migrateAppBundle
} from './utils/settings-bundle';
export type {
  AppName,
  AppBundleScope,
  SharedSettingsBundle,
  AppSettingsBundle
} from './utils/settings-bundle';

// Re-export types from @reborn/types for convenience
export type {
  BooleanInt,
  TaskEncrypted,
  TaskEncryptedBooleans,
  ListEncrypted,
  StorageOfflineOperation
} from '@reborn/types';

/**
 * Initialize the storage system
 * This should be called once at app startup
 */
/**
 * Initialize the storage system.
 *
 * @param appName - Unique app identifier ('task' or 'notes').
 *   Each app gets its own IndexedDB database with only the stores
 *   it needs, preventing cross-app data loss in the offline-first
 *   architecture. SSO works via shared localStorage on the same origin.
 */
export async function initializeStorage(appName: 'task' | 'notes'): Promise<void> {
  const { getDatabaseConfig } = await import('./stores/base.store');
  const { initDatabase, isDatabaseInitialized, getDatabase, databaseManager } = await import(
    './core/database'
  );
  const logger = createLogger('storage');

  /** Timeout (ms) for individual IndexedDB open operations. */
  const IDB_OPEN_TIMEOUT_MS = 8_000;

  /** Race a promise against a timeout. Rejects on expiry. */
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      )
    ]);
  }

  try {
    // Check if already initialized
    if (isDatabaseInitialized()) {
      logger.debug('Database already initialized, skipping');
      return;
    }

    // If the connection was closed (e.g. to unblock another tab's upgrade),
    // try to reconnect before going through full initialization.
    const reconnected = await withTimeout(
      databaseManager.reconnect(),
      IDB_OPEN_TIMEOUT_MS,
      'databaseManager.reconnect()'
    );
    if (reconnected) {
      logger.info('Database reconnected after connection loss');
      return;
    }

    const config = getDatabaseConfig(appName);

    logger.info('Initializing storage', {
      dbName: config.name,
      version: config.version,
      appName
    });

    // Pre-check: only delete if the current version is HIGHER than expected
    // (downgrade scenario, e.g. app rollback). For same or lower versions,
    // initDatabase()'s upgrade callback handles creating missing stores safely.
    try {
      const { openDB } = await import('idb');

      try {
        const checkDb = await withTimeout(
          openDB(config.name),
          IDB_OPEN_TIMEOUT_MS,
          'pre-check openDB'
        );
        const currentVersion = checkDb.version;
        checkDb.close();

        if (currentVersion > config.version) {
          logger.warn('Database version downgrade required', {
            currentVersion,
            expectedVersion: config.version,
            action: 'Will recreate database'
          });

          try {
            await indexedDB.deleteDatabase(config.name);
            logger.info('Old database deleted for downgrade');
          } catch (deleteError) {
            logger.warn('Failed to delete old database', deleteError);
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        } else if (currentVersion < config.version) {
          logger.info('Database will be upgraded', {
            currentVersion,
            targetVersion: config.version
          });
        }
      } catch {
        // Database doesn't exist yet — initDatabase will create it
        logger.debug('No existing database found, will create new one');
      }
    } catch (error) {
      logger.error('Database pre-check failed', error);
    }

    const db = await withTimeout(
      initDatabase(config),
      IDB_OPEN_TIMEOUT_MS,
      'initDatabase'
    );
    logger.info('Storage initialized successfully', {
      dbName: config.name,
      actualVersion: db.version,
      stores: Array.from(db.objectStoreNames)
    });

    // Verify all expected stores exist
    const missingStores = config.stores
      .filter((store) => !db.objectStoreNames.contains(store.name))
      .map((store) => store.name);

    if (missingStores.length > 0) {
      logger.error('Some stores were not created', { missingStores });
      throw new Error(`Failed to create stores: ${missingStores.join(', ')}`);
    }
  } catch (error) {
    logger.error('Failed to initialize storage', error);
    throw error;
  }
}

/**
 * Clean up storage (useful for logout)
 */
export async function cleanupStorage(): Promise<void> {
  const { closeDatabase } = await import('./core/database');
  const logger = createLogger('storage');

  try {
    await closeDatabase();
    logger.info('Storage cleaned up successfully');
  } catch (error) {
    logger.error('Failed to cleanup storage', error);
    throw error;
  }
}

/**
 * Clear all user data (useful for logout or account deletion)
 */
export async function clearAllUserData(): Promise<void> {
  const logger = createLogger('storage');

  try {
    const { getDatabase } = await import('./core/database');
    const db = getDatabase();
    const existingStores = new Set(Array.from(db.objectStoreNames));

    // Import all stores
    const {
      taskStore,
      listStore,
      offlineOperationsStore,
      subtaskStore,
      noteStore,
      folderStore,
      tagStore,
      savedSearchStore,
      noteTagStore,
      noteHistoryStore,
      folderSyncStore,
      userStore,
      syncStateStore,
      settingsOperations
    } = await import('./stores');

    // Clear only stores that exist in the current app's database.
    // After per-app schema isolation (v11), Task DB has no notes stores
    // and Notes DB has no task stores.

    // Task stores
    if (existingStores.has('tasks')) await taskStore.clear();
    if (existingStores.has('taskLists')) await listStore.clear();
    if (existingStores.has('subtasks')) await subtaskStore.clear();

    // Notes stores
    if (existingStores.has('notes')) await noteStore.clear();
    if (existingStores.has('folders')) await folderStore.clear();
    if (existingStores.has('tags')) await tagStore.clear();
    if (existingStores.has('savedSearches')) await savedSearchStore.clear();
    if (existingStores.has('noteTags')) await noteTagStore.clear();
    if (existingStores.has('noteHistory')) await noteHistoryStore.clear();
    // Folder sync config holds a directory handle granting read access to a
    // local directory - must not leak to the next account on this browser.
    if (existingStores.has('folderSyncConfigs')) await folderSyncStore.clear();

    // Common stores (always present)
    await offlineOperationsStore.clear();
    await userStore.clear();
    await syncStateStore.clear();
    await settingsOperations.clearAllSettings();

    logger.info('All user data cleared from IndexedDB', {
      clearedStores: Array.from(existingStores)
    });
  } catch (error) {
    logger.error('Failed to clear user data', error);
    throw error;
  }
}
