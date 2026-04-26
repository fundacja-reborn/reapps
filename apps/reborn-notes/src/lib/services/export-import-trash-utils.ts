/**
 * Decide whether an incoming backup entity should override the local
 * timestamp guard because it is restoring an item from the local trash.
 *
 * Backup is treated as authoritative for `is_archived`: when the local
 * version is archived (in trash) but the backup version is active, we
 * import the backup even if the local `updated_at` is newer. The reverse
 * direction (local active, backup archived) intentionally returns `false`
 * so that newer local edits aren't silently discarded — the user can
 * still re-archive locally if they really meant to.
 *
 * `is_archived` is optional on `NoteEncryptedSchema` (operational plain
 * field); `undefined`/`null` is normalized to `false` on both sides.
 * `FolderEncryptedSchema` requires the field, so legacy folder backups
 * without it are rejected by Zod before reaching this helper.
 */
export function shouldRestoreFromTrash(
  existing: { is_archived?: boolean | null } | null | undefined,
  incoming: { is_archived?: boolean | null }
): boolean {
  if (!existing) return false;
  return existing.is_archived === true && (incoming.is_archived ?? false) === false;
}

/**
 * Decide whether a note should have its `folder_id` re-linked back to the
 * backup's folder while preserving local content edits. Used when the
 * local note is "newer" by timestamp (so the full-backup path skips it),
 * but the only reason it's newer is a side-effect of folder deletion —
 * `deleteFolder` rewrites `folder_id = null` on every child note, bumping
 * `updated_at`. Without re-link, restoring the folder from backup leaves
 * its notes orphaned in "All notes".
 *
 * Returns `true` only when ALL hold:
 *   - the local note exists and is newer than the backup version;
 *   - the local note is NOT in trash with the backup active (that case
 *     is handled by {@link shouldRestoreFromTrash} — the full restore
 *     wins, content and all);
 *   - the backup specifies a `folder_id` that is being restored or
 *     created in this same import (so we know the folder was either
 *     deleted or absent locally — relinking can't accidentally overwrite
 *     a deliberate move into a still-existing folder);
 *   - the local `folder_id` actually differs from the backup one.
 *
 * The caller, on `true`, persists `existing` with only `folder_id`
 * overridden, `updated_at = now`, and pending sync — title/content/
 * metadata/shadow indexes stay as the user last edited them.
 */
export function shouldRelinkToBackupFolder(
  existing:
    | {
        folder_id?: string | null;
        updated_at: string;
        is_archived?: boolean | null;
      }
    | null
    | undefined,
  incoming: {
    folder_id?: string | null;
    updated_at: string;
    is_archived?: boolean | null;
  },
  restoredOrCreatedFolderIds: Set<string>
): boolean {
  if (!existing) return false;
  if (existing.updated_at < incoming.updated_at) return false;
  if (shouldRestoreFromTrash(existing, incoming)) return false;
  if (!incoming.folder_id) return false;
  if (!restoredOrCreatedFolderIds.has(incoming.folder_id)) return false;
  return (existing.folder_id ?? null) !== (incoming.folder_id ?? null);
}
