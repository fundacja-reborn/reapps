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
