import type { SyncableEncryptedEntity } from '../base';

/**
 * Folder appearance bundled into `metadata_encrypted` (zero knowledge: the
 * server only ever sees one padded ciphertext). Both values are KEYS from the
 * client's closed sets (a palette color like `blue`, a lucide icon like
 * `briefcase`), never a hex value or an arbitrary icon name - the client maps
 * them to theme-aware shades and components, and renders the default for a
 * key it does not know (e.g. one written by a newer app version).
 */
export interface FolderSensitiveMetadata {
  color?: string;
  icon?: string;
}

export interface FolderDecrypted {
  id: string;
  parent_id?: string;
  name: string;
  /** Palette color key from `metadata_encrypted` (see FolderSensitiveMetadata). */
  color?: string;
  /** Icon key from `metadata_encrypted` (see FolderSensitiveMetadata). */
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
  metadata_encrypted?: string; // Contains FolderSensitiveMetadata (padded)
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

/** Maximum encrypted folder metadata bundle - server Zod. Contains FolderSensitiveMetadata. */
export const MAX_ENCRYPTED_FOLDER_METADATA_BYTES = 2_000;
