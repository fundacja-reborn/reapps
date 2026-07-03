import type { SyncableEncryptedEntity } from '../base';

/**
 * Saved search ("smart folder"): a named, E2E-encrypted search query string.
 *
 * The query is stored verbatim and re-parsed client-side by the same
 * `parseQuery()` (@reborn/utils) that powers live search, so a saved search
 * always evaluates against the current dataset. `folder_id` optionally "parks"
 * the search inside the folder tree - purely presentational, it does not scope
 * the query. The server only ever sees ciphertexts plus the folder FK.
 */
export interface SavedSearchDecrypted {
  id: string;
  name: string;
  query: string;
  /** Whether the "search in content" toggle was on when the search was saved. */
  search_in_content: boolean;
  /**
   * Whether the search is pinned to the top level of the folder tree as a
   * "smart folder". Mutually exclusive with `folder_id` (folder-pin) - a search
   * with a `folder_id` is treated as folder-pinned regardless of this flag.
   * Derived from the encrypted metadata bundle, so the server never learns it.
   */
  pinned_to_root: boolean;
  folder_id?: string;
  position: number;
  created_at: string;
  updated_at: string;
  /**
   * True when any of the row's ciphertexts could not be decrypted with the
   * current master key (foreign key epoch / corrupted data). Such a row keeps
   * empty name/query and default metadata; the UI renders an explicit
   * placeholder and only offers deletion.
   */
  decrypt_failed?: boolean;
}

/**
 * Behavioral metadata bundle, encrypted as one JSON object (same pattern as
 * NoteSensitiveMetadata). The server must not learn which saved searches scan
 * note bodies - that correlates with how sensitive the underlying query is - nor
 * which are pinned to the top level (root-pin is an encrypted flag, unlike the
 * plaintext `folder_id` FK that folder-pins must use for the SetNull relation).
 */
export interface SavedSearchSensitiveMetadata {
  search_in_content: boolean;
  /** Pinned to the top level of the folder tree (smart folder). Absent ⇒ false. */
  pinned_to_root?: boolean;
}

export interface SavedSearchEncrypted extends SyncableEncryptedEntity {
  name_encrypted: string;
  query_encrypted: string;
  metadata_encrypted?: string;
  folder_id?: string;
  position: number;
}

// ─── Size limits ─────────────────────────────────────────────────────

/** Maximum plaintext saved-search name length in characters (client-side). */
export const MAX_SAVED_SEARCH_NAME_CHARS = 100;

/** Maximum plaintext saved-search query length in characters (client-side). */
export const MAX_SAVED_SEARCH_QUERY_CHARS = 512;

/** Maximum encrypted saved-search name - server Zod. Mirrors folder names. */
export const MAX_ENCRYPTED_SAVED_SEARCH_NAME_BYTES = 750;

/** Maximum encrypted saved-search query - server Zod. 512 plaintext chars fit with margin. */
export const MAX_ENCRYPTED_SAVED_SEARCH_QUERY_BYTES = 2_000;

/** Maximum encrypted saved-search metadata bundle - server Zod. Tiny JSON flag object. */
export const MAX_ENCRYPTED_SAVED_SEARCH_METADATA_BYTES = 500;
