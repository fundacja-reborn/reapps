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
 * A subsequent regression also surfaced via `user_id`: if the auth store
 * hadn't hydrated by the time a sync pull ran, `get(authStore).userId!`
 * (non-null assertion) silently produced `undefined` and the local IDB
 * record carried that value forward. Once exported, every backup repeated
 * the pollution and import refused the entries.
 *
 * Schemas now accept null FKs and the importer overrides user_id from the
 * current account, but local IDB still carries the legacy values — every
 * fresh export would re-emit them. This helper rewrites those records in
 * place so the next backup comes out clean. Idempotent and runs at most
 * once per browser profile per migration version (gated by a localStorage
 * flag with the version baked into the key).
 */
import { noteStore, folderStore } from '@reborn/storage';
import type { FolderEncrypted, NoteStoredLocal } from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('IdbCleanup');

/**
 * Bumped from v1 → v2 when user_id repair was added. v1 ran before this
 * change and only handled null FK fields; v2 re-runs everywhere so user_id
 * pollution gets cleaned up too. The flag for v1 is intentionally left
 * behind — it costs nothing and avoids re-running v1 logic on profiles
 * that already migrated.
 */
const FLAG_KEY = 'reborn-notes:idb-null-fk-cleanup-v2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * Repair `user_id` on a record if the stored value is null, undefined,
 * empty, or anything other than a valid UUID. We only attempt repair when
 * the caller supplies a known-good `currentUserId`. Returning the record
 * untouched is safe — the importer will override user_id at validation
 * time anyway. Repairing locally just stops every fresh export from
 * propagating the legacy garbage to a new backup file.
 *
 * Exported for unit testing.
 */
export function repairUserId<T extends { user_id?: unknown }>(
  record: T,
  currentUserId: string | null
): { cleaned: T; changed: boolean } {
  const stored = record.user_id;
  const validStored = typeof stored === 'string' && UUID_RE.test(stored);
  if (validStored) return { cleaned: record, changed: false };
  if (!currentUserId || !UUID_RE.test(currentUserId)) {
    return { cleaned: record, changed: false };
  }
  return { cleaned: { ...record, user_id: currentUserId }, changed: true };
}

/**
 * Rewrite locally-stored notes and folders that hold `null` in
 * optional-but-not-nullable fields, and repair `user_id` when it is
 * missing or malformed. Runs at most once per browser profile per
 * migration version.
 *
 * Safe to call before sync — the rewrite only touches local IDB and does
 * not change `sync_status` or `sync_version`, so it doesn't trigger an
 * unnecessary push. Repaired user_id is local-only repair; the server
 * already knows the correct user_id from the request session.
 *
 * @param currentUserId Current user's UUID (from authStore). When provided,
 *   records with invalid/missing user_id are repaired in place. When null
 *   (e.g. cleanup runs before authentication completes), the user_id pass
 *   is skipped — the next boot will run cleanup again because the migration
 *   flag is only set on completion.
 */
export async function cleanupNullFkFields(currentUserId: string | null = null): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(FLAG_KEY)) return;

  try {
    const [notes, folders] = await Promise.all([
      noteStore.getAll() as Promise<NoteStoredLocal[]>,
      folderStore.getAll() as Promise<FolderEncrypted[]>
    ]);

    let notesCleaned = 0;
    let foldersCleaned = 0;
    let userIdRepaired = 0;

    for (const note of notes) {
      let working = note;
      let changed = false;
      const nullPass = dropNullFields(working, NOTE_FIELDS_TO_CLEAN);
      if (nullPass.changed) {
        working = nullPass.cleaned;
        changed = true;
      }
      const uidPass = repairUserId(working, currentUserId);
      if (uidPass.changed) {
        working = uidPass.cleaned;
        changed = true;
        userIdRepaired++;
      }
      if (changed) {
        await noteStore.save(working);
        notesCleaned++;
      }
    }

    for (const folder of folders) {
      let working = folder;
      let changed = false;
      const nullPass = dropNullFields(working, FOLDER_FIELDS_TO_CLEAN);
      if (nullPass.changed) {
        working = nullPass.cleaned;
        changed = true;
      }
      const uidPass = repairUserId(working, currentUserId);
      if (uidPass.changed) {
        working = uidPass.cleaned;
        changed = true;
        userIdRepaired++;
      }
      if (changed) {
        await folderStore.save(working);
        foldersCleaned++;
      }
    }

    // Only mark the migration done if we actually had a chance to repair
    // user_id (i.e. caller supplied a userId). If currentUserId was null
    // we stopped short of the user_id pass, so re-run on next boot when
    // auth is hopefully ready.
    if (currentUserId) {
      localStorage.setItem(FLAG_KEY, new Date().toISOString());
    }
    if (notesCleaned > 0 || foldersCleaned > 0) {
      logger.info('Cleaned local IDB', {
        notes: notesCleaned,
        folders: foldersCleaned,
        userIdRepaired
      });
    }
  } catch (error) {
    // Don't block app startup — leave the flag unset so we retry next boot.
    logger.warn('IDB cleanup failed; will retry next boot', error);
  }
}
