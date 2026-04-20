import type { IDBPDatabase } from 'idb';

/**
 * Configuration for database indexes
 */
export interface IndexConfig {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

/**
 * Configuration for a store.
 *
 * Note: stores share a single per-app IndexedDB database instance managed by
 * the `databaseManager` singleton, so they do not carry their own database
 * name. Each app calls `initializeStorage('task' | 'notes')`, which builds
 * the database via `getDatabaseConfig()` (e.g. `Reborn_task_DB`).
 */
export interface StoreConfig<TStored, TPublic = TStored> {
  storeName: string;
  version?: number;
  indexes?: IndexConfig[];
  primaryKey?: string;
  transform?: {
    toStorage: (item: TPublic) => TStored;
    fromStorage: (item: TStored) => TPublic;
  };
}

/**
 * Query options for filtering and sorting
 */
export interface QueryOptions {
  index?: string;
  direction?: 'next' | 'prev';
  limit?: number;
  offset?: number;
}

/**
 * Result of a batch operation
 */
export interface BatchResult {
  success: number;
  failed: number;
  errors: Error[];
}

/**
 * Database instance type
 */
export type DBInstance = IDBPDatabase<unknown>;

/**
 * Generic constraint for entities with an id
 */
export interface WithId {
  id: string;
}
