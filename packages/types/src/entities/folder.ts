import type { SyncableEncryptedEntity } from '../base';

export interface FolderDecrypted {
  id: string;
  parent_id?: string;
  name: string;
  color?: string;
  icon?: string;
  order_index: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  /**
   * True when the folder's ciphertext could not be decrypted with the current
   * master key (foreign key epoch / corrupted data). Such a row keeps an empty
   * name; the UI renders an explicit placeholder and offers rename (repair) or
   * deletion. The folder's structure and contents stay fully usable - only the
   * name is ciphertext.
   */
  decrypt_failed?: boolean;
}

export interface FolderEncrypted extends SyncableEncryptedEntity {
  parent_id?: string;
  name_encrypted: string;
  metadata_encrypted?: string; // color, icon etc.
  order_index: number;
  is_archived: boolean;
}

export interface FolderWithChildren extends FolderDecrypted {
  children?: FolderWithChildren[];
}

// ─── Size limits ─────────────────────────────────────────────────────

/** Maximum plaintext folder name size in bytes. */
export const MAX_FOLDER_NAME_BYTES = 500; // ~250 Unicode chars

/** Maximum encrypted folder name - server Zod. */
export const MAX_ENCRYPTED_FOLDER_NAME_BYTES = 750;

/** Maximum encrypted folder metadata bundle - server Zod. Contains color, icon. */
export const MAX_ENCRYPTED_FOLDER_METADATA_BYTES = 2_000;
