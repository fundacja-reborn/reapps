import type { SyncableEncryptedEntity, SyncErrorCode } from '../base';

// ─── Sensitive metadata bundle (encrypted, never sent as plaintext) ──

/**
 * Periodic-note kind. Mirrors `@reborn/storage` `PeriodicKind`; redeclared here
 * to keep `@reborn/types` free of cross-package deps.
 */
export type NotePeriodicKind = 'daily' | 'weekly' | 'monthly';

/**
 * Identifies a note as belonging to a periodic series (Daily/Weekly/Monthly).
 * The `anchor` is a locale-independent ISO date string that locks the note to
 * a specific period regardless of the title format:
 *   - daily   -> 'YYYY-MM-DD' of the day
 *   - weekly  -> 'YYYY-MM-DD' of the Monday of that ISO week
 *   - monthly -> 'YYYY-MM-01' of that month
 *
 * Matching is done on `(folder_id, kind, anchor)` so locale changes (PL/EN/DE
 * weekday names) cannot create duplicates for the same period.
 */
export interface PeriodicNoteMetadata {
  kind: NotePeriodicKind;
  /** ISO `YYYY-MM-DD` (always 10 chars). See type doc for kind-specific rules. */
  anchor: string;
}

/** Behavioral metadata bundled into metadata_encrypted for zero-knowledge. */
export interface NoteSensitiveMetadata {
  is_starred?: boolean;
  is_pinned?: boolean;
  tags?: string[]; // tag IDs — filtering moved client-side
  /** Set when this note was created by the Periodic Notes feature. */
  periodic?: PeriodicNoteMetadata;
}

// ─── Decrypted type (UI representation) ──────────────────────────────

export interface NoteDecrypted {
  id: string;
  folder_id?: string;
  title: string;
  content: string;
  tags?: string[];
  is_pinned?: boolean;
  is_starred?: boolean;
  is_archived?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

// ─── Encrypted type (server/sync — no plaintext sensitive data) ──────

/** Wire format sent to/from server. is_starred/is_pinned inside metadata_encrypted. */
export interface NoteEncrypted extends SyncableEncryptedEntity {
  folder_id?: string;
  title_encrypted: string;
  content_encrypted: string;
  metadata_encrypted?: string; // Contains NoteSensitiveMetadata
  is_archived?: boolean; // Operational (like deleted_at) — stays plain
}

// ─── Local storage type (IndexedDB — shadow indexes for queries) ─────

// `SyncErrorCode` moved to `../base` (both apps produce it now); re-exported
// there. NoteStoredLocal still pairs it with `sync_status: 'sync_error'`.

/** Extended with local-only shadow indexes extracted from decrypted metadata. */
export interface NoteStoredLocal extends NoteEncrypted {
  is_pinned?: boolean;
  is_starred?: boolean;
  /**
   * Set when the last push of this note was permanently rejected (see
   * `SyncErrorCode`). Always paired with `sync_status: 'sync_error'`. Cleared on
   * a successful push, or whenever a local edit re-marks the note 'pending'.
   */
  sync_error_code?: SyncErrorCode;
}

/** Maximum number of version snapshots kept per note (client and server). */
export const MAX_NOTE_VERSIONS = 10;

/** Maximum plaintext size of a single note (title + content) in bytes — enforced client-side. */
export const MAX_NOTE_CONTENT_BYTES = 500_000; // 500 KB

/** Maximum encrypted payload size per note field — enforced server-side via Zod. */
export const MAX_ENCRYPTED_CONTENT_BYTES = 750_000; // ~500 KB plaintext + encryption overhead

/** Maximum encrypted note title size — server Zod. */
export const MAX_ENCRYPTED_NOTE_TITLE_BYTES = 1_500; // ~1 KB plaintext + encryption overhead

/** Maximum encrypted metadata bundle size — server Zod. Contains is_starred, is_pinned, tag IDs. */
export const MAX_ENCRYPTED_NOTE_METADATA_BYTES = 10_000; // ~7 KB plaintext — enough for ~200 tag UUIDs

/** Default per-user storage quota in bytes (configurable via USER_STORAGE_LIMIT_BYTES env). */
export const DEFAULT_USER_STORAGE_LIMIT_BYTES = 104_857_600; // 100 MB

/** Note version snapshot stored in IndexedDB (encrypted, synced with server). */
export interface NoteHistoryEntry {
  id: string;
  note_id: string;
  title_encrypted: string;
  content_encrypted: string;
  sync_status: 'pending' | 'synced';
  created_at: string;
}

/** Decrypted version snapshot — used only in UI (on-demand decryption). */
export interface NoteHistoryDecrypted {
  id: string;
  note_id: string;
  title: string;
  content: string;
  created_at: string;
}
