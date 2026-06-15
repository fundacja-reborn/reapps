/**
 * Base interface for all encrypted entities in the system
 */
export interface EncryptedEntity {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/**
 * Interface for entities that support synchronization
 */
export interface Syncable {
  sync_version: number;
  // 'sync_error' marks an entity whose push was permanently rejected by the
  // server (a 4xx the client cannot fix by retrying). It is dropped from the
  // periodic-push retry set so a poisoned record stops re-sending forever.
  // Currently produced only by reborn-notes (per-note hard rejections).
  sync_status: 'pending' | 'synced' | 'conflict' | 'sync_error';
  last_sync_at?: string | null;
  synced_at?: string | null; // Legacy compatibility
  server_id?: string;
  device_id?: string;
}

/**
 * Combined interface for encrypted and syncable entities
 */
export interface SyncableEncryptedEntity extends EncryptedEntity, Syncable {}
