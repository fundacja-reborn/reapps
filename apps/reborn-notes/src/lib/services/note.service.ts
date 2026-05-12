/**
 * Note service for Reborn Notes.
 *
 * Wraps @reborn/storage note operations with E2E encryption via CryptoManager.
 * Notes are always encrypted with the user's master key — E2E must be unlocked before use.
 */
import {
  noteStore,
  noteQueries,
  noteOperations,
  noteTagStore,
  noteTagQueries,
  noteHistoryQueries,
  noteHistoryOperations
} from '@reborn/storage';
import { MAX_NOTE_VERSIONS, type NoteStoredLocal, type NoteDecrypted, type NoteHistoryEntry, type NoteHistoryDecrypted, type NoteSensitiveMetadata, type PeriodicNoteMetadata } from '@reborn/types';
import { cryptoManager } from '@reborn/crypto';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth.store';
import { noteIndex } from '$lib/services/note-index.svelte';
import {
  pushNote,
  pushNoteUpdate,
  pushNoteDelete,
  pushNoteRestore,
  pushNoteVersion
} from './notes-sync.service';

export type SortBy = 'updated_at' | 'created_at' | 'title';

// ── User identity ─────────────────────────────────────────────────

function getUserId(): string {
  const state = get(authStore);
  return state.userId!;
}

// ── Codec ─────────────────────────────────────────────────────────

async function encodeText(text: string): Promise<string> {
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] encodeText called without master key loaded');
  }
  return cryptoManager.encryptText(text);
}

async function decodeText(stored: string): Promise<string> {
  if (!stored) return '';
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] decodeText called without master key loaded');
  }
  try {
    return await cryptoManager.decryptText(stored);
  } catch {
    return ''; // deszyfrowanie nie powiodło się (uszkodzone dane)
  }
}

async function toDecrypted(enc: NoteStoredLocal): Promise<NoteDecrypted> {
  return {
    id: enc.id,
    folder_id: enc.folder_id,
    title: await decodeText(enc.title_encrypted),
    content: await decodeText(enc.content_encrypted),
    // Shadow indexes (available directly on NoteStoredLocal)
    is_pinned: enc.is_pinned,
    is_starred: enc.is_starred,
    is_archived: enc.is_archived,
    created_at: enc.created_at,
    updated_at: enc.updated_at
  };
}

/** Decrypt only the title (skip content_encrypted) — used by NoteIndex cache. */
export async function decryptTitleOnly(enc: NoteStoredLocal): Promise<{
  id: string;
  title: string;
  folderId: string | undefined;
  isPinned: boolean;
  isStarred: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}> {
  return {
    id: enc.id,
    title: await decodeText(enc.title_encrypted),
    folderId: enc.folder_id,
    // Shadow indexes (available directly on NoteStoredLocal)
    isPinned: enc.is_pinned ?? false,
    isStarred: enc.is_starred ?? false,
    isArchived: enc.is_archived ?? false,
    createdAt: enc.created_at,
    updatedAt: enc.updated_at
  };
}

export function sortNotes(notes: NoteDecrypted[], sortBy: SortBy = 'updated_at'): NoteDecrypted[] {
  const sorted = [...notes].sort((a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }
    const aTime = new Date(sortBy === 'created_at' ? a.created_at : a.updated_at).getTime();
    const bTime = new Date(sortBy === 'created_at' ? b.created_at : b.updated_at).getTime();
    return bTime - aTime;
  });
  // Pinned notes always first
  return [...sorted.filter((n) => n.is_pinned), ...sorted.filter((n) => !n.is_pinned)];
}

function sortByUpdated(notes: NoteDecrypted[]): NoteDecrypted[] {
  return sortNotes(notes, 'updated_at');
}

/** Filter notes by search query (title + content substring match). */
export function filterNotes(notes: NoteDecrypted[], query: string): NoteDecrypted[] {
  if (!query.trim()) return notes;
  const q = query.toLowerCase();
  return notes.filter(
    (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );
}

/** Filter notes by title only (default search — fast, no content scan). */
export function filterNotesByTitle(notes: NoteDecrypted[], query: string): NoteDecrypted[] {
  if (!query.trim()) return notes;
  const q = query.toLowerCase();
  return notes.filter((n) => n.title.toLowerCase().includes(q));
}

/** Attach tag IDs to notes in bulk (avoids N+1 queries). */
async function attachTagIds(notes: NoteDecrypted[]): Promise<NoteDecrypted[]> {
  if (notes.length === 0) return notes;
  const allRelations = await noteTagStore.getAll();
  const tagMap = new Map<string, string[]>();
  for (const rel of allRelations) {
    const arr = tagMap.get(rel.note_id) ?? [];
    arr.push(rel.tag_id);
    tagMap.set(rel.note_id, arr);
  }
  return notes.map((note) => ({ ...note, tags: tagMap.get(note.id) ?? [] }));
}

// ── Public API ───────────────────────────────────────────────────

/** All active (non-archived) notes, sorted by last updated. */
export async function getAllNotes(): Promise<NoteDecrypted[]> {
  const notes = await noteQueries.getActive();
  const decrypted = await Promise.all(notes.map(toDecrypted));
  return attachTagIds(sortByUpdated(decrypted));
}

/**
 * Notes in a specific folder (null = root/unorganized notes, undefined = all notes).
 */
export async function getNotesByFolder(
  folderId: string | null | undefined
): Promise<NoteDecrypted[]> {
  let notes: NoteStoredLocal[];
  if (folderId === undefined) {
    notes = await noteQueries.getActive();
  } else {
    notes = await noteQueries.byFolder(folderId);
  }
  const decrypted = await Promise.all(notes.map(toDecrypted));
  return attachTagIds(sortByUpdated(decrypted));
}

/**
 * Active notes belonging to any of the given folders (subtree search).
 * Empty array → empty result.
 */
export async function getNotesByFolders(folderIds: string[]): Promise<NoteDecrypted[]> {
  if (folderIds.length === 0) return [];
  const notes = await noteQueries.byFolders(folderIds);
  const decrypted = await Promise.all(notes.map(toDecrypted));
  return attachTagIds(sortByUpdated(decrypted));
}

/** Notes that have a specific tag, sorted by last updated. */
export async function getNotesByTag(tagId: string): Promise<NoteDecrypted[]> {
  const noteIds = await noteTagQueries.getNotesForTag(tagId);
  const noteEncryptedList = await Promise.all(noteIds.map((id) => noteStore.get(id)));
  const active = noteEncryptedList.filter((n): n is NoteStoredLocal => n != null && !n.is_archived);
  const decrypted = await Promise.all(active.map(toDecrypted));
  return attachTagIds(sortByUpdated(decrypted));
}

/** Get a single note by ID. */
export async function getNote(id: string): Promise<NoteDecrypted | null> {
  const enc = await noteStore.get(id);
  if (!enc || enc.is_archived) return null;
  return toDecrypted(enc);
}

/** Get a single note by ID, including archived (trash) notes. */
export async function getNoteIncludingArchived(id: string): Promise<NoteDecrypted | null> {
  const enc = await noteStore.get(id);
  if (!enc) return null;
  return toDecrypted(enc);
}

/**
 * Create a new note. Returns the new note ID.
 *
 * `options.createdAt` / `options.updatedAt` let importers preserve original
 * timestamps from a source file (e.g. Obsidian `created:` / `modified:`
 * frontmatter). Both default to `now` when omitted, preserving legacy
 * behavior for existing callsites.
 */
export async function createNote(
  title: string,
  content = '',
  folderId?: string,
  options?: {
    createdAt?: string;
    updatedAt?: string;
    skipSync?: boolean;
    /**
     * Tag this note as belonging to a Periodic Notes series (Daily/Weekly/Monthly).
     * Stored inside `metadata_encrypted` so the server never sees the kind/anchor
     * - this is how the Periodic feature matches existing notes for a given period
     * regardless of locale-dependent title formatting.
     */
    periodic?: PeriodicNoteMetadata;
  }
): Promise<string> {
  const now = new Date().toISOString();
  const createdAt = options?.createdAt ?? now;
  const updatedAt = options?.updatedAt ?? now;
  const id = crypto.randomUUID();
  const metadata: NoteSensitiveMetadata = {
    is_pinned: false,
    is_starred: false,
    tags: []
  };
  if (options?.periodic) metadata.periodic = options.periodic;
  const metadataEncrypted = await cryptoManager.encryptObject<NoteSensitiveMetadata>(metadata);
  const note: NoteStoredLocal = {
    id,
    user_id: getUserId(),
    folder_id: folderId,
    title_encrypted: await encodeText(title.trim() || 'Untitled'),
    content_encrypted: await encodeText(content),
    metadata_encrypted: metadataEncrypted,
    is_archived: false,
    // Shadow indexes (local-only)
    is_pinned: false,
    is_starred: false,
    sync_version: 0,
    sync_status: 'pending',
    created_at: createdAt,
    updated_at: updatedAt
  };
  await noteStore.save(note);
  if (!options?.skipSync) {
    pushNote(note);
  }
  noteIndex.update(id, {
    title: title.trim() || 'Untitled',
    folderId: folderId,
    isPinned: false,
    isStarred: false,
    isArchived: false,
    createdAt,
    updatedAt,
    tagIds: []
  });
  return id;
}

/**
 * Update note title and/or content. Does NOT create version history — use saveVersionSnapshot().
 *
 * `options.updatedAt` lets importers preserve the source file's modified
 * timestamp (e.g. Obsidian frontmatter) when overwriting an existing note.
 * `options.skipSync` defers the network push to the caller — used by batch
 * importers that bulk-push at the end to avoid per-file race conditions.
 */
export async function updateNote(
  id: string,
  title: string,
  content: string,
  options?: { updatedAt?: string; skipSync?: boolean }
): Promise<void> {
  const existing = await noteStore.get(id);
  if (!existing) throw new Error('Note not found');
  const updatedAt = options?.updatedAt ?? new Date().toISOString();
  const updated: NoteStoredLocal = {
    ...existing,
    title_encrypted: await encodeText(title),
    content_encrypted: await encodeText(content),
    updated_at: updatedAt,
    sync_status: 'pending'
  };
  await noteStore.save(updated);
  if (!options?.skipSync) {
    pushNoteUpdate(id, {
      title_encrypted: updated.title_encrypted,
      content_encrypted: updated.content_encrypted
    });
  }
  noteIndex.patch(id, {
    title,
    updatedAt
  });
}

/** Rename note title only. */
export async function renameNote(id: string, title: string): Promise<void> {
  const existing = await noteStore.get(id);
  if (!existing) throw new Error('Note not found');
  const now = new Date().toISOString();
  const title_encrypted = await encodeText(title.trim() || 'Untitled');
  await noteStore.save({
    ...existing,
    title_encrypted,
    updated_at: now,
    sync_status: 'pending'
  });
  pushNoteUpdate(id, { title_encrypted });
  noteIndex.patch(id, {
    title: title.trim() || 'Untitled',
    updatedAt: now
  });
}

/** Soft-delete (archive) a note. */
export async function deleteNote(id: string): Promise<void> {
  const existing = await noteStore.get(id);
  await noteOperations.archive(id);

  // Update cache: mark as archived
  noteIndex.patch(id, {
    isArchived: true,
    updatedAt: new Date().toISOString()
  });

  // Note never reached the server — skip DELETE and mark as synced locally.
  if (!existing || existing.sync_status === 'pending') {
    const archived = await noteStore.get(id);
    if (archived) await noteStore.save({ ...archived, sync_status: 'synced' });
    return;
  }

  // Mark pending so pushPendingItems can retry if pushNoteDelete fails.
  const archived = await noteStore.get(id);
  if (archived) await noteStore.save({ ...archived, sync_status: 'pending' });
  pushNoteDelete(id);
}

/** Move a note to a different folder (null = root/unorganized). */
export async function moveNoteToFolder(id: string, folderId: string | null): Promise<void> {
  await noteOperations.moveToFolder(id, folderId);
  const current = await noteStore.get(id);
  if (current) await noteStore.save({ ...current, sync_status: 'pending' });
  // Send null (not undefined) so the server's `'folder_id' in data` check fires
  // and Prisma actually clears the column when moving to root.
  pushNoteUpdate(id, { folder_id: folderId });
  noteIndex.patch(id, { folderId: folderId ?? undefined });
}

/**
 * Decrypt metadata bundle for a note, falling back to defaults if absent or
 * corrupted. Used by callsites that need to read/modify a single metadata
 * field without losing the others. Returns `null` if the note doesn't exist.
 */
export async function readNoteMetadata(id: string): Promise<NoteSensitiveMetadata | null> {
  const existing = await noteStore.get(id);
  if (!existing) return null;
  if (!existing.metadata_encrypted) return {};
  try {
    return await cryptoManager.decryptObject<NoteSensitiveMetadata>(existing.metadata_encrypted);
  } catch {
    return {};
  }
}

/**
 * Stamp `periodic` (kind + anchor) onto an existing note's metadata. Preserves
 * any other metadata fields (pinned/starred/tags). Used by the Periodic Notes
 * lazy backfill to adopt legacy notes that were created before metadata-based
 * matching existed.
 *
 * No-op if the note's metadata already has a matching `periodic` entry.
 */
export async function setNotePeriodicMetadata(
  id: string,
  periodic: PeriodicNoteMetadata
): Promise<void> {
  const existing = await noteStore.get(id);
  if (!existing) return;

  let meta: NoteSensitiveMetadata = {};
  if (existing.metadata_encrypted) {
    try {
      meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(existing.metadata_encrypted);
    } catch {
      meta = {};
    }
  }
  if (meta.periodic?.kind === periodic.kind && meta.periodic.anchor === periodic.anchor) {
    return;
  }
  meta.periodic = periodic;
  const metadataEncrypted = await cryptoManager.encryptObject(meta);
  await noteStore.save({
    ...existing,
    metadata_encrypted: metadataEncrypted,
    sync_status: 'pending'
  });
  pushNoteUpdate(id, { metadata_encrypted: metadataEncrypted });
}

/** Toggle pin status. */
export async function togglePin(id: string): Promise<void> {
  const existing = await noteStore.get(id);
  if (!existing) return;
  const newPinned = !existing.is_pinned;

  // Update metadata_encrypted with new pin status
  let meta: NoteSensitiveMetadata = { is_pinned: newPinned, is_starred: existing.is_starred };
  try {
    if (existing.metadata_encrypted) {
      meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(existing.metadata_encrypted);
      meta.is_pinned = newPinned;
    }
  } catch { /* use default */ }
  const metadataEncrypted = await cryptoManager.encryptObject(meta);

  await noteStore.save({
    ...existing,
    is_pinned: newPinned,
    metadata_encrypted: metadataEncrypted,
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  pushNoteUpdate(id, { metadata_encrypted: metadataEncrypted });
  noteIndex.patch(id, { isPinned: newPinned });
}

/** Toggle star status. */
export async function toggleStar(id: string): Promise<void> {
  const existing = await noteStore.get(id);
  if (!existing) return;
  const newStarred = !existing.is_starred;

  // Update metadata_encrypted with new star status
  let meta: NoteSensitiveMetadata = { is_starred: newStarred, is_pinned: existing.is_pinned };
  try {
    if (existing.metadata_encrypted) {
      meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(existing.metadata_encrypted);
      meta.is_starred = newStarred;
    }
  } catch { /* use default */ }
  const metadataEncrypted = await cryptoManager.encryptObject(meta);

  await noteStore.save({
    ...existing,
    is_starred: newStarred,
    metadata_encrypted: metadataEncrypted,
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  pushNoteUpdate(id, { metadata_encrypted: metadataEncrypted });
  noteIndex.patch(id, { isStarred: newStarred });
}

// ── Trash (Kosz) ─────────────────────────────────────────────────

/** Get all archived (trashed) notes, newest first. */
export async function getArchivedNotes(): Promise<NoteDecrypted[]> {
  const notes = await noteQueries.getArchived();
  const decrypted = await Promise.all(notes.map(toDecrypted));
  return decrypted.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

/** Restore a note from trash (unarchive). */
export async function restoreNote(id: string): Promise<void> {
  await noteOperations.unarchive(id);
  const current = await noteStore.get(id);
  if (current) await noteStore.save({ ...current, sync_status: 'pending' });
  // Update cache: mark as not archived
  noteIndex.patch(id, { isArchived: false });
  pushNoteRestore(id);
}

/** Permanently delete a note and all its history. */
export async function permanentlyDeleteNote(id: string): Promise<void> {
  await noteHistoryOperations.deleteAllForNote(id);
  await noteStore.delete(id);
  noteIndex.remove(id);
  pushNoteDelete(id, true);
}

/** Permanently delete all notes in trash (and their history). */
export async function emptyTrash(): Promise<number> {
  const archived = await noteQueries.getArchived();
  if (archived.length === 0) return 0;

  // Delete version history for every trashed note
  await Promise.all(archived.map((n) => noteHistoryOperations.deleteAllForNote(n.id)));

  // Batch-delete from IndexedDB
  await noteStore.deleteMany(archived.map((n) => n.id));

  // Remove from index cache
  for (const n of archived) {
    noteIndex.remove(n.id);
  }

  // Push permanent deletes to server (fire-and-forget, skip never-synced notes)
  for (const n of archived) {
    if (n.sync_status !== 'pending') {
      pushNoteDelete(n.id, true);
    }
  }

  return archived.length;
}

/** Remove archived notes older than `daysOld` days permanently. */
export async function cleanTrash(daysOld = 30): Promise<number> {
  return noteOperations.cleanArchived(daysOld);
}

// ── Version History ───────────────────────────────────────────────

/**
 * Save a version snapshot for a note (copies ciphertext from IndexedDB — zero re-encryption).
 * Skips if note content is identical to the latest version. Prunes to MAX_NOTE_VERSIONS.
 */
export async function saveVersionSnapshot(noteId: string): Promise<void> {
  const existing = await noteStore.get(noteId);
  if (!existing) return;

  // Compare with latest version — skip if identical (avoid duplicate snapshots)
  const latest = await noteHistoryQueries.getForNote(noteId);
  if (latest.length > 0) {
    const top = latest[0];
    if (
      top.title_encrypted === existing.title_encrypted &&
      top.content_encrypted === existing.content_encrypted
    ) {
      return; // No change since last snapshot
    }
  }

  const versionId = await noteHistoryOperations.saveVersion({
    note_id: noteId,
    title_encrypted: existing.title_encrypted,
    content_encrypted: existing.content_encrypted,
    sync_status: 'pending',
    created_at: existing.updated_at
  });
  await noteHistoryOperations.pruneVersions(noteId, MAX_NOTE_VERSIONS);

  // Push to server (fire-and-forget)
  pushNoteVersion({
    id: versionId,
    note_id: noteId,
    title_encrypted: existing.title_encrypted,
    content_encrypted: existing.content_encrypted,
    sync_status: 'pending',
    created_at: existing.updated_at
  });
}

/** Get version history for a note — raw encrypted entries (newest first). */
export async function getNoteHistory(noteId: string): Promise<NoteHistoryEntry[]> {
  return noteHistoryQueries.getForNote(noteId);
}

/** Get version history decrypted on-demand (for UI display). */
export async function getNoteHistoryDecrypted(noteId: string): Promise<NoteHistoryDecrypted[]> {
  const entries = await noteHistoryQueries.getForNote(noteId);
  return Promise.all(
    entries.map(async (e) => ({
      id: e.id,
      note_id: e.note_id,
      title: await decodeText(e.title_encrypted),
      content: await decodeText(e.content_encrypted),
      created_at: e.created_at
    }))
  );
}

/** Restore a specific version — overwrites current note content. */
export async function restoreNoteVersion(
  noteId: string,
  entry: NoteHistoryDecrypted
): Promise<void> {
  await updateNote(noteId, entry.title, entry.content);
}

// ── Encryption X-Ray ──────────────────────────────────────────────

/** Read raw encrypted note from IndexedDB without decrypting (for X-Ray visualization). */
export async function getRawEncryptedNote(
  id: string
): Promise<{
  title_encrypted: string;
  content_encrypted: string;
  metadata_encrypted?: string;
} | null> {
  const enc = await noteStore.get(id);
  if (!enc) return null;
  return {
    title_encrypted: enc.title_encrypted,
    content_encrypted: enc.content_encrypted,
    metadata_encrypted: enc.metadata_encrypted
  };
}
