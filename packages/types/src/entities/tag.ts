import type { SyncableEncryptedEntity } from '../base';

export interface TagDecrypted {
  id: string;
  name: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface TagEncrypted extends SyncableEncryptedEntity {
  name_encrypted: string;
  color_encrypted?: string;
}

export interface NoteTag {
  note_id: string;
  tag_id: string;
  created_at: string;
}

// ─── Size limits ─────────────────────────────────────────────────────

/** Maximum plaintext tag name size in bytes. */
export const MAX_TAG_NAME_BYTES = 200; // ~100 Unicode chars

/** Maximum encrypted tag name — server Zod. */
export const MAX_ENCRYPTED_TAG_NAME_BYTES = 350;

/** Maximum encrypted tag color — server Zod. Color is ~7 chars (#RRGGBB), encrypted ~100-150 bytes. */
export const MAX_ENCRYPTED_TAG_COLOR_BYTES = 200;
