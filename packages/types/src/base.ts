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
  sync_status: 'pending' | 'synced' | 'conflict';
  last_sync_at?: string | null;
  synced_at?: string | null; // Legacy compatibility
  server_id?: string;
  device_id?: string;
}

/**
 * Combined interface for encrypted and syncable entities
 */
export interface SyncableEncryptedEntity extends EncryptedEntity, Syncable {}
