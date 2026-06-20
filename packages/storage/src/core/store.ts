import { createLogger } from '@reborn/utils';
import { validateEncryptedPayload } from '@reborn/crypto';
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import { databaseManager } from './database';
import type { StoreConfig, QueryOptions, BatchResult, WithId } from './types';
import { writable, type Writable } from 'svelte/store';

const logger = createLogger('storage:store');

/**
 * Generic IndexedDB store implementation
 */
export class IndexedDBStore<TStored extends WithId, TPublic extends WithId = TStored> {
  private config: StoreConfig<TStored, TPublic>;
  public items: Writable<TPublic[]>;

  constructor(config: StoreConfig<TStored, TPublic>) {
    this.config = {
      primaryKey: 'id',
      ...config
    };
    this.items = writable([]);
    // Usunięto automatyczne wywołanie refreshItems() z konstruktora
  }

  /**
   * Get the database instance
   */
  private getDb(): IDBPDatabase | null {
    if (!databaseManager.isInitialized()) {
      return null;
    }
    return databaseManager.getDatabase();
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
   * using the last known config rather than dropping the write.
   */
  private async requireDb(): Promise<IDBPDatabase> {
    if (databaseManager.isInitialized()) return databaseManager.getDatabase();
    await databaseManager.reconnect();
    if (databaseManager.isInitialized()) return databaseManager.getDatabase();
    throw new Error('Database not initialized (reconnect failed).');
  }

  /**
   * Transform item for storage if transformer is configured
   */
  private toStorage(item: TPublic): TStored {
    return this.config.transform?.toStorage(item) ?? (item as unknown as TStored);
  }

  /**
   * Transform item from storage if transformer is configured
   */
  private fromStorage(item: TStored): TPublic {
    return this.config.transform?.fromStorage(item) ?? (item as unknown as TPublic);
  }

  /**
   * Refresh the items store from IndexedDB
   */
  public async refreshItems() {
    try {
      // Skip if database is not initialized
      if (!databaseManager.isInitialized()) {
        logger.debug('Skipping refresh - database not initialized', {
          store: this.config.storeName
        });
        this.items.set([]);
        return;
      }

      const db = this.getDb();
      if (!db) {
        logger.debug('Skipping refresh - database is null', { store: this.config.storeName });
        this.items.set([]);
        return;
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.warn('Store does not exist in database during refresh', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames),
          dbVersion: db.version
        });
        this.items.set([]);
        return;
      }

      const all = await this.getAll();
      this.items.set(all);
    } catch (error) {
      logger.error('Failed to refresh items', { store: this.config.storeName, error });
      this.items.set([]);
    }
  }

  /**
   * Get a single item by ID
   */
  async get(id: string): Promise<TPublic | null> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning null', {
          store: this.config.storeName,
          id
        });
        return null;
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.warn('Store does not exist in database, returning null', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames)
        });
        return null;
      }

      const stored = (await db.get(this.config.storeName, id)) as TStored | undefined;

      if (!stored) {
        return null;
      }

      return this.fromStorage(stored);
    } catch (error) {
      logger.error('Failed to get item', { id, store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Get multiple items by IDs
   */
  async getMany(ids: string[]): Promise<TPublic[]> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning empty array', {
          store: this.config.storeName
        });
        return [];
      }
      const tx = db.transaction(this.config.storeName, 'readonly');
      const store = tx.objectStore(this.config.storeName);

      const results: TPublic[] = [];

      for (const id of ids) {
        const stored = (await store.get(id)) as TStored | undefined;
        if (stored) {
          results.push(this.fromStorage(stored));
        }
      }

      await tx.done;
      return results;
    } catch (error) {
      logger.error('Failed to get multiple items', { ids, store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Get all items from the store
   */
  async getAll(): Promise<TPublic[]> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning empty array', {
          store: this.config.storeName
        });
        return [];
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.warn('Store does not exist in database, returning empty array', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames)
        });
        return [];
      }

      const stored = (await db.getAll(this.config.storeName)) as TStored[];
      return stored.map((item) => this.fromStorage(item));
    } catch (error) {
      logger.error('Failed to get all items', { store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Save a single item
   */
  async save(item: TPublic): Promise<void> {
    try {
      const db = await this.requireDb();
      const stored = this.toStorage(item);

      // Pre-save encryption guard: validate all *_encrypted fields
      validateEncryptedPayload(stored as unknown as Record<string, unknown>);

      // Special logging for tasks to debug position issue
      if (this.config.storeName === 'tasks' && 'position' in stored) {
        logger.info('Saving task with position', {
          id: item.id,
          position: (stored as any).position,
          storedType: typeof (stored as any).position
        });
      }

      await db.put(this.config.storeName, stored);
      logger.debug('Item saved', { id: item.id, store: this.config.storeName });
      await this.refreshItems();
    } catch (error) {
      logger.error('Failed to save item', {
        id: item.id,
        store: this.config.storeName,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save multiple items in a batch
   */
  async saveMany(items: TPublic[]): Promise<BatchResult> {
    const result: BatchResult = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      const db = await this.requireDb();
      const tx = db.transaction(this.config.storeName, 'readwrite');
      const store = tx.objectStore(this.config.storeName);

      for (const item of items) {
        try {
          const stored = this.toStorage(item);
          // Pre-save encryption guard: validate all *_encrypted fields
          validateEncryptedPayload(stored as unknown as Record<string, unknown>);
          await store.put(stored);
          result.success++;
        } catch (error) {
          result.failed++;
          result.errors.push(error as Error);
          logger.error('Failed to save item in batch', { id: item.id, error });
        }
      }

      await tx.done;
      logger.info('Batch save completed', {
        store: this.config.storeName,
        success: result.success,
        failed: result.failed
      });
      await this.refreshItems();
      return result;
    } catch (error) {
      logger.error('Batch save failed', { store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Delete a single item by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const db = await this.requireDb();
      await db.delete(this.config.storeName, id);
      logger.debug('Item deleted', { id, store: this.config.storeName });
      await this.refreshItems();
    } catch (error) {
      logger.error('Failed to delete item', { id, store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Delete multiple items by IDs
   */
  async deleteMany(ids: string[]): Promise<void> {
    const result: BatchResult = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      const db = await this.requireDb();
      const tx = db.transaction(this.config.storeName, 'readwrite');
      const store = tx.objectStore(this.config.storeName);

      for (const id of ids) {
        try {
          await store.delete(id);
          result.success++;
        } catch (error) {
          result.failed++;
          result.errors.push(error as Error);
          logger.error('Failed to delete item in batch', { id, error });
        }
      }

      await tx.done;
      logger.info('Batch delete completed', {
        store: this.config.storeName,
        success: result.success,
        failed: result.failed
      });
      await this.refreshItems();
    } catch (error) {
      logger.error('Batch delete failed', { store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Query items using an index
   */
  async query(index: string, value: any, options?: QueryOptions): Promise<TPublic[]> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning empty array', {
          store: this.config.storeName,
          index,
          value
        });
        return [];
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.warn('Store does not exist in database, returning empty array', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames)
        });
        return [];
      }

      const tx = db.transaction(this.config.storeName, 'readonly');
      const store = tx.objectStore(this.config.storeName);
      const idx = store.index(index);

      let cursor = await idx.openCursor(IDBKeyRange.only(value), options?.direction);
      const results: TPublic[] = [];
      let count = 0;
      const offset = options?.offset || 0;
      const limit = options?.limit || Infinity;

      while (cursor) {
        if (count >= offset && results.length < limit) {
          results.push(this.fromStorage(cursor.value as TStored));
        }
        count++;

        if (count >= offset + limit) {
          break;
        }

        cursor = await cursor.continue();
      }

      await tx.done;
      logger.debug('Query completed', {
        store: this.config.storeName,
        index,
        value,
        count: results.length
      });

      return results;
    } catch (error) {
      logger.error('Query failed', {
        store: this.config.storeName,
        index,
        value,
        error
      });
      throw error;
    }
  }

  /**
   * Query items using an index with a range
   */
  async queryRange(
    index: string,
    lower: any,
    upper: any,
    options?: QueryOptions & { lowerOpen?: boolean; upperOpen?: boolean }
  ): Promise<TPublic[]> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning empty array', {
          store: this.config.storeName,
          index,
          lower,
          upper
        });
        return [];
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.warn('Store does not exist in database, returning empty array', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames)
        });
        return [];
      }

      const tx = db.transaction(this.config.storeName, 'readonly');
      const store = tx.objectStore(this.config.storeName);
      const idx = store.index(index);

      const range = IDBKeyRange.bound(
        lower,
        upper,
        options?.lowerOpen || false,
        options?.upperOpen || false
      );

      let cursor = await idx.openCursor(range, options?.direction);
      const results: TPublic[] = [];
      let count = 0;
      const offset = options?.offset || 0;
      const limit = options?.limit || Infinity;

      while (cursor) {
        if (count >= offset && results.length < limit) {
          results.push(this.fromStorage(cursor.value as TStored));
        }
        count++;

        if (count >= offset + limit) {
          break;
        }

        cursor = await cursor.continue();
      }

      await tx.done;
      logger.debug('Range query completed', {
        store: this.config.storeName,
        index,
        lower,
        upper,
        count: results.length
      });

      return results;
    } catch (error) {
      logger.error('Range query failed', {
        store: this.config.storeName,
        index,
        lower,
        upper,
        error
      });
      throw error;
    }
  }

  /**
   * Count items in the store
   */
  async count(): Promise<number> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning 0', { store: this.config.storeName });
        return 0;
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.debug('Store does not exist in database, returning 0', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames)
        });
        return 0;
      }

      try {
        return await db.count(this.config.storeName);
      } catch (countError) {
        logger.debug('Count operation failed, returning 0', {
          store: this.config.storeName,
          error: countError
        });
        return 0;
      }
    } catch (error) {
      logger.error('Failed to count items', { store: this.config.storeName, error });
      // Don't throw for count operations - return 0 instead
      return 0;
    }
  }

  /**
   * Count items matching an index value
   */
  async countByIndex(index: string, value: any): Promise<number> {
    try {
      const db = this.getDb();
      if (!db) {
        logger.debug('Database not initialized, returning 0', {
          store: this.config.storeName,
          index,
          value
        });
        return 0;
      }

      // Check if the store exists in the database
      if (!db.objectStoreNames.contains(this.config.storeName)) {
        logger.debug('Store does not exist in database, returning 0', {
          store: this.config.storeName,
          availableStores: Array.from(db.objectStoreNames)
        });
        return 0;
      }

      try {
        const tx = db.transaction(this.config.storeName, 'readonly');
        const store = tx.objectStore(this.config.storeName);
        const idx = store.index(index);

        const count = await idx.count(IDBKeyRange.only(value));
        await tx.done;

        return count;
      } catch (txError) {
        // Store might not exist yet or index might not exist
        logger.debug('Transaction or index error, returning 0', {
          store: this.config.storeName,
          index,
          error: txError
        });
        return 0;
      }
    } catch (error) {
      logger.error('Failed to count by index', {
        store: this.config.storeName,
        index,
        value,
        error
      });
      // Don't throw for count operations - return 0 instead
      return 0;
    }
  }

  /**
   * Clear all items from the store
   */
  async clear(): Promise<void> {
    try {
      const db = await this.requireDb();
      await db.clear(this.config.storeName);
      logger.info('Store cleared', { store: this.config.storeName });
      await this.refreshItems();
    } catch (error) {
      logger.error('Failed to clear store', { store: this.config.storeName, error });
      throw error;
    }
  }

  /**
   * Check if an item exists
   */
  async exists(id: string): Promise<boolean> {
    try {
      const item = await this.get(id);
      return item !== null;
    } catch (error) {
      logger.error('Failed to check existence', { id, store: this.config.storeName, error });
      throw error;
    }
  }
}
