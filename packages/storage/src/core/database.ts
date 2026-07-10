import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import { createLogger } from '@reborn/utils';
import type { IndexConfig } from './types';

const logger = createLogger('storage:database');

interface DatabaseConfig {
  name: string;
  version: number;
  stores: StoreDefinition[];
}

export interface StoreDefinition {
  name: string;
  primaryKey?: string;
  indexes?: IndexConfig[];
}

class DatabaseManager {
  private db: IDBPDatabase | null = null;
  private config: DatabaseConfig | null = null;
  private initPromise: Promise<IDBPDatabase> | null = null;

  /**
   * Initialize the database with configuration
   */
  async initialize(config: DatabaseConfig): Promise<IDBPDatabase> {
    // If already initializing, return the existing promise
    if (this.initPromise) {
      return this.initPromise;
    }

    // If already initialized with same config, return existing db
    if (this.db && this.config?.name === config.name && this.config?.version === config.version) {
      return this.db;
    }

    // Close existing database if open
    if (this.db) {
      await this.close();
    }

    // Check current database version before opening
    try {
      const existingDb = await openDB(config.name, undefined, {
        blocking: () => {/* no-op: nothing to release on a version-change block */}
      });
      const currentVersion = existingDb.version;
      existingDb.close();
      
      if (currentVersion < config.version) {
        logger.info('Database version mismatch detected', {
          currentVersion,
          expectedVersion: config.version,
          action: 'Will upgrade database'
        });
      }
    } catch (checkError) {
      logger.debug('Could not check existing database version', checkError);
    }

    this.config = config;
    this.initPromise = this.openDatabase();
    
    try {
      this.db = await this.initPromise;
      return this.db;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Open the IndexedDB database
   */
  private async openDatabase(): Promise<IDBPDatabase> {
    if (!this.config) {
      throw new Error('Database configuration not set');
    }

    const config = this.config; // Capture config for closure
    logger.info('Opening database', { 
      name: config.name, 
      version: config.version,
      storesCount: config.stores.length,
      storeNames: config.stores.map(s => s.name)
    });
    
    // DEBUG: Log stack trace to see who's calling openDatabase
    logger.debug('openDatabase call stack', {
      stack: new Error().stack
    });

    return openDB(config.name, config.version, {
      upgrade(db, oldVersion, newVersion, transaction) {
        logger.info('Upgrading database', { 
          oldVersion, 
          newVersion,
          existingStores: Array.from(db.objectStoreNames)
        });

        // Create or update stores
        for (const store of config.stores) {
          let objectStore;
          
          // Create store if it doesn't exist
          if (!db.objectStoreNames.contains(store.name)) {
            objectStore = db.createObjectStore(store.name, {
              keyPath: store.primaryKey || 'id',
              autoIncrement: false
            });
            // logger.debug('Created object store', { store: store.name });
          } else {
            objectStore = transaction.objectStore(store.name);
            logger.debug('Store already exists', { store: store.name });
          }

          // Create indexes
          if (store.indexes) {
            for (const index of store.indexes) {
              if (!objectStore.indexNames.contains(index.name)) {
                objectStore.createIndex(
                  index.name,
                  index.keyPath,
                  {
                    unique: index.unique || false,
                    multiEntry: index.multiEntry || false
                  }
                );
                // logger.debug('Created index', { store: store.name, index: index.name });
              }
            }
          }
        }
        
        // Remove stores that don't belong to this app's config
        // (ghost stores from previous schema or stores from the other app)
        const expectedNames = new Set(config.stores.map(s => s.name));
        for (const existingName of Array.from(db.objectStoreNames)) {
          if (!expectedNames.has(existingName)) {
            db.deleteObjectStore(existingName);
            logger.info('Removed obsolete store', { store: existingName });
          }
        }

        logger.info('Database upgrade completed', {
          newStores: Array.from(db.objectStoreNames)
        });
      },
      blocked: () => {
        logger.warn('Database upgrade blocked by other tabs - waiting for them to close');
      },
      blocking: () => {
        // Another tab needs to upgrade the database. Close our connection
        // so the upgrade can proceed. The next operation that needs the DB
        // will re-initialize the connection at the new version.
        logger.warn('Another tab requested DB upgrade - closing connection to unblock');
        if (this.db) {
          this.db.close();
          this.db = null;
          this.initPromise = null;
        }
      },
      terminated: () => {
        logger.error('Database connection terminated unexpectedly');
        // Null out the dead connection so isInitialized() returns false
        // and the next call to initialize() will properly re-open the DB.
        this.db = null;
        this.initPromise = null;
      }
    });
  }

  /**
   * Get the current database instance.
   * If the connection was closed (e.g. to unblock another tab's upgrade),
   * automatically reconnects using the last known config.
   */
  getDatabase(): IDBPDatabase {
    if (!this.db) {
      if (this.config) {
        // Connection was closed but config is still known - schedule reconnect.
        // For now throw so callers handle the "not initialized" case gracefully;
        // the reconnect will happen on the next initializeStorage() or initialize() call.
        logger.debug('Database connection lost, will reconnect on next initialize()');
      }
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Reconnect to the database using the last known config.
   * Used after the connection was closed to unblock another tab's upgrade.
   */
  async reconnect(): Promise<IDBPDatabase | null> {
    if (this.db) return this.db;
    if (!this.config) return null;

    logger.info('Reconnecting to database after connection was closed');
    return this.initialize(this.config);
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.config = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Clear all data from a store
   */
  async clearStore(storeName: string): Promise<void> {
    const db = this.getDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).clear();
    await tx.done;
    logger.info('Cleared store', { store: storeName });
  }

  /**
   * Delete the entire database
   */
  async deleteDatabase(): Promise<void> {
    if (!this.config) {
      throw new Error('No database configuration set');
    }
    
    await this.close();
    await indexedDB.deleteDatabase(this.config.name);
    logger.info('Database deleted', { name: this.config.name });
  }
}

// Export singleton instance
export const databaseManager = new DatabaseManager();

// Export convenience functions
export const initDatabase = (config: DatabaseConfig) => databaseManager.initialize(config);
export const closeDatabase = () => databaseManager.close();
export const getDatabase = () => databaseManager.getDatabase();
export const isDatabaseInitialized = () => databaseManager.isInitialized();

/** Current connection for a read, or null when not initialized (callers soft-return empty). */
export function getDatabaseIfInitialized(): IDBPDatabase | null {
  return databaseManager.isInitialized() ? databaseManager.getDatabase() : null;
}

/**
 * Live DB connection for a write, reconnecting once if it was dropped.
 *
 * `databaseManager` nulls its connection out from under us in two cases: a
 * `blocking` upgrade requested by another tab, and `terminated` - which fires
 * when the platform tears the IndexedDB connection down (a Capacitor WKWebView
 * does this when the app is backgrounded / under memory pressure). After that
 * `getDatabase()` throws until the next `initialize()`, so a write issued
 * before any re-init would fail even though the database is perfectly healthy
 * on disk (a fresh `indexedDB.open` still works - exactly the asymmetry that
 * surfaced as folder-sync "Failed to save item" on iOS). Reconnect on the spot
 * using the last known config rather than dropping the write. Shared by every
 * store implementation (IndexedDBStore, SplitNoteStore).
 */
export async function requireDatabase(): Promise<IDBPDatabase> {
  if (databaseManager.isInitialized()) return databaseManager.getDatabase();
  await databaseManager.reconnect();
  if (databaseManager.isInitialized()) return databaseManager.getDatabase();
  throw new Error('Database not initialized (reconnect failed).');
}
