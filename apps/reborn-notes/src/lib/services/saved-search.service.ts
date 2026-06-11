/**
 * Saved search service for Reborn Notes.
 *
 * Wraps @reborn/storage saved-search operations with E2E encryption via
 * CryptoManager. Both the display name and the query string are always
 * encrypted with the user's master key - E2E must be unlocked before use.
 *
 * The query string is stored verbatim; consumers re-parse it with the same
 * `parseQuery()` (@reborn/utils) that powers live search, so a saved search
 * always evaluates against the current dataset. The optional `folder_id`
 * "parks" the search inside the folder tree - purely presentational, it does
 * not scope the query.
 */
import { savedSearchStore, savedSearchQueries } from '@reborn/storage';
import type {
  SavedSearchDecrypted,
  SavedSearchEncrypted,
  SavedSearchSensitiveMetadata
} from '@reborn/types';
import { MAX_SAVED_SEARCH_NAME_CHARS, MAX_SAVED_SEARCH_QUERY_CHARS } from '@reborn/types';
import { cryptoManager } from '@reborn/crypto';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth.store';
import {
  pushSavedSearch,
  pushSavedSearchUpdate,
  pushSavedSearchDelete
} from './notes-sync.service';

// ── User identity ─────────────────────────────────────────────────

function getUserId(): string {
  const state = get(authStore);
  return state.userId!;
}

// ── Codec ─────────────────────────────────────────────────────────

async function encode(value: string, what: 'name' | 'query'): Promise<string> {
  if (!cryptoManager.isInitialized()) {
    throw new Error(`[E2E] encode saved-search ${what} called without master key loaded`);
  }
  return cryptoManager.encryptText(value);
}

async function decode(stored: string): Promise<string> {
  if (!stored) return '';
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] decode saved-search called without master key loaded');
  }
  try {
    return await cryptoManager.decryptText(stored);
  } catch {
    return ''; // deszyfrowanie nie powiodło się (uszkodzone dane)
  }
}

async function decodeMetadata(stored?: string): Promise<SavedSearchSensitiveMetadata> {
  // Missing or undecryptable metadata degrades to the conservative default
  // (title-only search) instead of erroring - same posture as the name/query codec.
  if (!stored) return { search_in_content: false };
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] decode saved-search metadata called without master key loaded');
  }
  try {
    const meta = await cryptoManager.decryptObject<SavedSearchSensitiveMetadata>(stored);
    return { search_in_content: !!meta.search_in_content };
  } catch {
    return { search_in_content: false };
  }
}

async function toDecrypted(enc: SavedSearchEncrypted): Promise<SavedSearchDecrypted> {
  const meta = await decodeMetadata(enc.metadata_encrypted);
  return {
    id: enc.id,
    name: await decode(enc.name_encrypted),
    query: await decode(enc.query_encrypted),
    search_in_content: meta.search_in_content,
    folder_id: enc.folder_id,
    position: enc.position,
    created_at: enc.created_at,
    updated_at: enc.updated_at
  };
}

// ── Public API ───────────────────────────────────────────────────

/** All saved searches sorted by position, then name. */
export async function getAllSavedSearches(): Promise<SavedSearchDecrypted[]> {
  const all = await savedSearchStore.getAll();
  const decrypted = await Promise.all(all.map(toDecrypted));
  return decrypted.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * Save the given query under a name. Returns the new saved-search ID.
 * The query is stored as typed (trimmed) - no normalization, so what the user
 * sees in the search bar is exactly what re-runs later. `searchInContent`
 * captures the body-search toggle so applying the saved view reproduces the
 * exact result set, not just the query string (stored in the encrypted
 * metadata bundle - the server must not learn which views scan bodies).
 */
export async function createSavedSearch(
  name: string,
  query: string,
  searchInContent: boolean,
  folderId?: string
): Promise<string> {
  const trimmedName = name.trim().slice(0, MAX_SAVED_SEARCH_NAME_CHARS);
  const trimmedQuery = query.trim().slice(0, MAX_SAVED_SEARCH_QUERY_CHARS);
  if (!trimmedName) throw new Error('Saved search name must not be empty');
  if (!trimmedQuery) throw new Error('Saved search query must not be empty');

  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] encode saved-search metadata called without master key loaded');
  }
  // Always store the bundle, even for the default false - a row where
  // metadata_encrypted is only present when the toggle is on would leak the
  // toggle state to the server through the mere existence of the ciphertext.
  const metadata: SavedSearchSensitiveMetadata = { search_in_content: searchInContent };
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const search: SavedSearchEncrypted = {
    id,
    user_id: getUserId(),
    name_encrypted: await encode(trimmedName, 'name'),
    query_encrypted: await encode(trimmedQuery, 'query'),
    metadata_encrypted: await cryptoManager.encryptObject(metadata),
    folder_id: folderId,
    position: await savedSearchQueries.getNextPosition(),
    sync_version: 0,
    sync_status: 'pending',
    created_at: now,
    updated_at: now
  };
  await savedSearchStore.save(search);
  pushSavedSearch(search);
  return id;
}

/** Rename an existing saved search. */
export async function renameSavedSearch(id: string, name: string): Promise<void> {
  const existing = await savedSearchStore.get(id);
  if (!existing) throw new Error('Saved search not found');
  const trimmed = name.trim().slice(0, MAX_SAVED_SEARCH_NAME_CHARS);
  if (!trimmed) throw new Error('Saved search name must not be empty');
  const name_encrypted = await encode(trimmed, 'name');
  await savedSearchStore.save({
    ...existing,
    name_encrypted,
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  pushSavedSearchUpdate(id, { name_encrypted });
}

/**
 * Park a saved search in a folder (renders as a node in the folder tree),
 * or unpark it with `null` (search-panel list only).
 */
export async function moveSavedSearchToFolder(
  id: string,
  folderId: string | null
): Promise<void> {
  const existing = await savedSearchStore.get(id);
  if (!existing) throw new Error('Saved search not found');
  const { folder_id: _previous, ...rest } = existing;
  await savedSearchStore.save({
    ...rest,
    ...(folderId ? { folder_id: folderId } : {}),
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  pushSavedSearchUpdate(id, { folder_id: folderId });
}

/** Delete a saved search (local hard delete + server push). */
export async function deleteSavedSearch(id: string): Promise<void> {
  await savedSearchStore.delete(id);
  pushSavedSearchDelete(id);
}
