/**
 * One-shot IndexedDB cleanup migration.
 *
 * Historical reborn-notes builds occasionally wrote `null` (instead of
 * `undefined`) to optional-but-not-nullable fields on notes and folders —
 * most commonly `folder_id` (root notes) and `parent_id` (root folders).
 * The shape was tolerated locally but caused the JSON backup importer to
 * reject affected entries with "Invalid input" once Zod 4 tightened
 * `optional()` semantics.
 *
 * Schemas now accept null and the importer normalizes inputs, but local
 * IDB still carries the pollution — every fresh export would re-emit the
 * nulls. This helper rewrites those records in place so the next backup
 * comes out clean. It is idempotent and runs at most once per browser
 * profile (gated by a localStorage flag).
 */
import { noteStore, folderStore } from '@reborn/storage';
import type { FolderEncrypted, NoteStoredLocal } from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('IdbCleanup');

const FLAG_KEY = 'reborn-notes:idb-null-fk-cleanup-v1';

/** Optional-but-not-nullable fields that may have been written as `null`. */
const NOTE_FIELDS_TO_CLEAN = [
  'folder_id',
  'metadata_encrypted',
  'device_id',
  'is_archived'
] as const;
const FOLDER_FIELDS_TO_CLEAN = ['parent_id', 'metadata_encrypted', 'device_id'] as const;

function dropNullFields<T extends object>(record: T, fields: readonly string[]): { cleaned: T; changed: boolean } {
  const out = { ...record } as Record<string, unknown>;
  let changed = false;
  for (const field of fields) {
    if (out[field] === null) {
      delete out[field];
      changed = true;
    }
  }
  return { cleaned: out as T, changed };
}

/**
 * Rewrite locally-stored notes and folders that hold `null` in
 * optional-but-not-nullable fields. Runs at most once per browser profile.
 *
 * Safe to call before sync — the rewrite only touches local IDB and does
 * not change `sync_status` or `sync_version`, so it doesn't trigger an
 * unnecessary push.
 */
export async function cleanupNullFkFields(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(FLAG_KEY)) return;

  try {
    const [notes, folders] = await Promise.all([
      noteStore.getAll() as Promise<NoteStoredLocal[]>,
      folderStore.getAll() as Promise<FolderEncrypted[]>
    ]);

    let notesCleaned = 0;
    let foldersCleaned = 0;

    for (const note of notes) {
      const { cleaned, changed } = dropNullFields(note, NOTE_FIELDS_TO_CLEAN);
      if (changed) {
        await noteStore.save(cleaned);
        notesCleaned++;
      }
    }

    for (const folder of folders) {
      const { cleaned, changed } = dropNullFields(folder, FOLDER_FIELDS_TO_CLEAN);
      if (changed) {
        await folderStore.save(cleaned);
        foldersCleaned++;
      }
    }

    localStorage.setItem(FLAG_KEY, new Date().toISOString());
    if (notesCleaned > 0 || foldersCleaned > 0) {
      logger.info('Cleaned null FK fields from local IDB', {
        notes: notesCleaned,
        folders: foldersCleaned
      });
    }
  } catch (error) {
    // Don't block app startup — leave the flag unset so we retry next boot.
    logger.warn('IDB null-FK cleanup failed; will retry next boot', error);
  }
}
