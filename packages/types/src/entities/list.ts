import type { SyncableEncryptedEntity } from '../base';

export interface ListDecrypted {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  order_index: number;
  is_default?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface ListEncrypted extends SyncableEncryptedEntity {
  name_encrypted: string;
  metadata_encrypted?: string; // color, icon etc.
  order_index: number;
  is_default?: boolean;
}

// Legacy types for compatibility
export type TaskList = ListDecrypted;
export type DecryptedTaskList = ListDecrypted;
export type EncryptedTaskList = ListEncrypted;
export type StoredTaskList = ListEncrypted;
