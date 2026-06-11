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
  folder_id?: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SavedSearchEncrypted extends SyncableEncryptedEntity {
  name_encrypted: string;
  query_encrypted: string;
  folder_id?: string;
  position: number;
}

// ─── Size limits ─────────────────────────────────────────────────────

/** Maximum plaintext saved-search name length in characters (client-side). */
export const MAX_SAVED_SEARCH_NAME_CHARS = 100;

/** Maximum plaintext saved-search query length in characters (client-side). */
export const MAX_SAVED_SEARCH_QUERY_CHARS = 512;

/** Maximum encrypted saved-search name — server Zod. Mirrors folder names. */
export const MAX_ENCRYPTED_SAVED_SEARCH_NAME_BYTES = 750;

/** Maximum encrypted saved-search query — server Zod. 512 plaintext chars fit with margin. */
export const MAX_ENCRYPTED_SAVED_SEARCH_QUERY_BYTES = 2_000;
