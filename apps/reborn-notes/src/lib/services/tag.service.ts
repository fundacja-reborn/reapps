/**
 * Tag service for Reborn Notes.
 *
 * Wraps @reborn/storage tag/noteTag operations with E2E encryption via CryptoManager.
 * Tag names and colors are always encrypted with the user's master key — E2E must be unlocked before use.
 */
import {
  tagStore,
  tagOperations,
  noteTagQueries,
  noteTagOperations,
  type TagEncrypted
} from '@reborn/storage';
import type { TagDecrypted } from '@reborn/types';
import { cryptoManager } from '@reborn/crypto';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth.store';
import { pushTag, pushTagUpdate, pushTagDelete, pushNoteUpdate, pushNoteMutation } from './notes-sync.service';
import { noteStore } from '@reborn/storage';
import type { NoteSensitiveMetadata, NoteStoredLocal } from '@reborn/types';
import { noteIndex } from '$lib/services/note-index.svelte';

// ── User identity ─────────────────────────────────────────────────

function getUserId(): string {
  const state = get(authStore);
  return state.userId!;
}

/** Predefined color palette for tags. */
export const TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280' // gray
] as const;

// ── Codec ─────────────────────────────────────────────────────────

async function encodeName(name: string): Promise<string> {
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] encodeName called without master key loaded');
  }
  return cryptoManager.encryptText(name);
}

async function decodeName(stored: string): Promise<string> {
  if (!stored) return '';
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] decodeName called without master key loaded');
  }
  try {
    return await cryptoManager.decryptText(stored);
  } catch {
    return ''; // deszyfrowanie nie powiodło się (uszkodzone dane)
  }
}

async function encodeColor(color: string): Promise<string> {
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] encodeColor called without master key loaded');
  }
  return cryptoManager.encryptText(color);
}

async function decodeColor(stored: string): Promise<string> {
  if (!stored) return '';
  if (!cryptoManager.isInitialized()) {
    throw new Error('[E2E] decodeColor called without master key loaded');
  }
  try {
    return await cryptoManager.decryptText(stored);
  } catch {
    return ''; // deszyfrowanie nie powiodło się (uszkodzone dane)
  }
}

async function toDecrypted(enc: TagEncrypted): Promise<TagDecrypted> {
  return {
    id: enc.id,
    name: await decodeName(enc.name_encrypted),
    color: enc.color_encrypted ? await decodeColor(enc.color_encrypted) : undefined,
    created_at: enc.created_at,
    updated_at: enc.updated_at
  };
}

// ── Public API ───────────────────────────────────────────────────

/** All tags sorted alphabetically. */
export async function getAllTags(): Promise<TagDecrypted[]> {
  const tags = await tagStore.getAll();
  const decrypted = await Promise.all(tags.map(toDecrypted));
  return decrypted.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create a new tag. Returns the new tag ID.
 *
 * `options.skipSync` defers the network push to the caller — used by batch
 * importers that bulk-push everything via `pushPendingItems()` at the end so
 * folders/tags land before any note that references them.
 */
export async function createTag(
  name: string,
  color?: string,
  options?: { skipSync?: boolean }
): Promise<string> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const tag = {
    id,
    user_id: getUserId(),
    name_encrypted: await encodeName(name.trim()),
    color_encrypted: color ? await encodeColor(color) : undefined,
    usage_count: 0,
    sync_version: 0,
    sync_status: 'pending' as const,
    created_at: now,
    updated_at: now
  };
  await tagOperations.saveTag(tag);
  if (!options?.skipSync) {
    pushTag({
      id,
      name_encrypted: tag.name_encrypted,
      color_encrypted: tag.color_encrypted,
      created_at: now
    });
  }
  return id;
}

/** Rename an existing tag. */
export async function renameTag(id: string, name: string): Promise<void> {
  const existing = await tagStore.get(id);
  if (!existing) throw new Error('Tag not found');
  const name_encrypted = await encodeName(name.trim());
  await tagOperations.saveTag({
    ...existing,
    name_encrypted,
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  pushTagUpdate(id, { name_encrypted });
}

/** Update the color of a tag (undefined = no color). */
export async function updateTagColor(id: string, color: string | undefined): Promise<void> {
  const existing = await tagStore.get(id);
  if (!existing) throw new Error('Tag not found');
  const color_encrypted = color ? await encodeColor(color) : undefined;
  await tagOperations.saveTag({
    ...existing,
    color_encrypted,
    updated_at: new Date().toISOString(),
    sync_status: 'pending'
  });
  pushTagUpdate(id, { color_encrypted: color_encrypted ?? null });
}

/** Delete a tag and all its note-tag relationships. */
export async function deleteTag(id: string): Promise<void> {
  // Get affected notes before removing relationships
  const affectedNoteIds = await noteTagQueries.getNotesForTag(id);
  await noteTagOperations.removeAllNotesFromTag(id);
  await tagStore.delete(id);
  pushTagDelete(id);
  // Remove deleted tagId from index entries and update metadata_encrypted
  for (const noteId of affectedNoteIds) {
    const entry = noteIndex.get(noteId);
    if (entry) {
      noteIndex.patch(noteId, { tagIds: entry.tagIds.filter((t) => t !== id) });
    }
    // Update metadata_encrypted to remove deleted tag
    const existing = await noteStore.get(noteId);
    if (existing) {
      const currentTagIds = await noteTagQueries.getTagsForNote(noteId);
      let meta: NoteSensitiveMetadata = {
        is_pinned: existing.is_pinned,
        is_starred: existing.is_starred,
        tags: currentTagIds
      };
      try {
        if (existing.metadata_encrypted) {
          meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(
            existing.metadata_encrypted
          );
          meta.tags = currentTagIds;
        }
      } catch {
        /* use default */
      }
      const metadataEncrypted = await cryptoManager.encryptObject(meta);
      await noteStore.save({
        ...existing,
        metadata_encrypted: metadataEncrypted,
        updated_at: new Date().toISOString(),
        sync_status: 'pending'
      });
      pushNoteUpdate(noteId, { metadata_encrypted: metadataEncrypted });
    }
  }
}

/** Get tag IDs assigned to a note. */
export async function getTagIdsForNote(noteId: string): Promise<string[]> {
  return noteTagQueries.getTagsForNote(noteId);
}

/** Get full tag objects assigned to a note. */
export async function getTagsForNote(noteId: string): Promise<TagDecrypted[]> {
  const tagIds = await noteTagQueries.getTagsForNote(noteId);
  const tags = await Promise.all(tagIds.map((tid) => tagStore.get(tid)));
  const valid = tags.filter((t): t is NonNullable<typeof t> => t != null);
  const decrypted = await Promise.all(valid.map(toDecrypted));
  return decrypted.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Replace all tags on a note with the given tag IDs.
 * Updates usage_count on affected tags.
 */
export async function setTagsForNote(noteId: string, tagIds: string[], options?: { skipSync?: boolean }): Promise<void> {
  const currentTagIds = await noteTagQueries.getTagsForNote(noteId);
  const toAdd = tagIds.filter((id) => !currentTagIds.includes(id));
  const toRemove = currentTagIds.filter((id) => !tagIds.includes(id));

  for (const tagId of toAdd) {
    await noteTagOperations.addTagToNote(noteId, tagId);
    try {
      await tagOperations.incrementUsage(tagId);
    } catch {
      // tag may have been deleted concurrently — ignore
    }
  }
  for (const tagId of toRemove) {
    await noteTagOperations.removeTagFromNote(noteId, tagId);
    try {
      await tagOperations.decrementUsage(tagId);
    } catch {
      // ignore
    }
  }
  // Update metadata_encrypted with new tag IDs (E2E — tags stay encrypted)
  const existing = await noteStore.get(noteId);
  if (existing) {
    let meta: NoteSensitiveMetadata = {
      is_pinned: existing.is_pinned,
      is_starred: existing.is_starred,
      tags: tagIds
    };
    try {
      if (existing.metadata_encrypted) {
        meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(
          existing.metadata_encrypted
        );
        meta.tags = tagIds;
      }
    } catch {
      /* use default */
    }
    const wasEphemeral = existing.is_ephemeral === true;
    const metadataEncrypted = await cryptoManager.encryptObject(meta);
    const updated: NoteStoredLocal = {
      ...existing,
      metadata_encrypted: metadataEncrypted,
      updated_at: new Date().toISOString(),
      sync_status: 'pending',
      ...(wasEphemeral ? { is_ephemeral: false } : {})
    };
    await noteStore.save(updated);
    if (!options?.skipSync) {
      // Tagging is a deliberate "keep it" action - promotes a pristine ephemeral
      // note via POST (a PATCH would 404 - the server has no row yet). #349
      pushNoteMutation(updated, wasEphemeral, { metadata_encrypted: metadataEncrypted });
    }
  }
  // Update tagIds in the NoteIndex cache
  noteIndex.patch(noteId, { tagIds });
}

/** Get note IDs that have a specific tag. */
export async function getNotesForTag(tagId: string): Promise<string[]> {
  return noteTagQueries.getNotesForTag(tagId);
}

/**
 * Merge sourceTag into targetTag.
 * All notes with sourceTag will be reassigned to targetTag, then sourceTag is deleted.
 */
export async function mergeTags(sourceTagId: string, targetTagId: string): Promise<void> {
  const noteIds = await noteTagQueries.getNotesForTag(sourceTagId);
  for (const noteId of noteIds) {
    const hasTarget = await noteTagQueries.noteHasTag(noteId, targetTagId);
    if (!hasTarget) {
      await noteTagOperations.addTagToNote(noteId, targetTagId);
    }
    await noteTagOperations.removeTagFromNote(noteId, sourceTagId);
    // Update index: replace sourceTag with targetTag
    const entry = noteIndex.get(noteId);
    if (entry) {
      const newTagIds = entry.tagIds.filter((t) => t !== sourceTagId);
      if (!newTagIds.includes(targetTagId)) newTagIds.push(targetTagId);
      noteIndex.patch(noteId, { tagIds: newTagIds });
    }
    // Update metadata_encrypted with new tag assignments
    const existing = await noteStore.get(noteId);
    if (existing) {
      const currentTagIds = await noteTagQueries.getTagsForNote(noteId);
      let meta: NoteSensitiveMetadata = {
        is_pinned: existing.is_pinned,
        is_starred: existing.is_starred,
        tags: currentTagIds
      };
      try {
        if (existing.metadata_encrypted) {
          meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(
            existing.metadata_encrypted
          );
          meta.tags = currentTagIds;
        }
      } catch {
        /* use default */
      }
      const metadataEncrypted = await cryptoManager.encryptObject(meta);
      await noteStore.save({
        ...existing,
        metadata_encrypted: metadataEncrypted,
        updated_at: new Date().toISOString(),
        sync_status: 'pending'
      });
      pushNoteUpdate(noteId, { metadata_encrypted: metadataEncrypted });
    }
  }
  await tagStore.delete(sourceTagId);
  // Recalculate target usage
  const targetNotes = await noteTagQueries.getNotesForTag(targetTagId);
  try {
    await tagOperations.updateTagCounts(targetTagId, targetNotes.length);
  } catch {
    // ignore
  }
}
