/**
 * The data-change watermark: the newest `updated_at` across the user's local
 * notes, folders and tags. The backup scheduler uses it for skip-if-unchanged
 * (don't rewrite an identical file day after day) - see `isBackupDue` in
 * `@reborn/backup`.
 *
 * Reads the encrypted stores directly (not the decrypted view stores): a max of
 * a plaintext timestamp needs no decryption, and `updated_at` is a plaintext
 * column on every syncable entity. Soft-deletes / trash moves bump `updated_at`
 * and are captured; a pure hard-delete that lowers the max is intentionally not
 * treated as a change (a backup restores data, it does not record absence).
 */

import { noteStore, folderStore, tagStore } from '@reborn/storage';

/** Newest parseable `updated_at` in `items`, as epoch ms, or -Infinity if none. */
function maxUpdatedAt(items: Array<{ updated_at: string }>): number {
  let max = -Infinity;
  for (const item of items) {
    const ms = Date.parse(item.updated_at);
    if (!Number.isNaN(ms) && ms > max) max = ms;
  }
  return max;
}

/**
 * Max `updated_at` across notes/folders/tags as an ISO string, or null when
 * there is no data at all (which the scheduler treats as "nothing to back up").
 */
export async function getLastDataChangeAt(): Promise<string | null> {
  const [notes, folders, tags] = await Promise.all([
    // updated_at lives on the meta row - skip the content blobs (DB v14 split).
    noteStore.getAllMeta(),
    folderStore.getAll(),
    tagStore.getAll()
  ]);

  const max = Math.max(maxUpdatedAt(notes), maxUpdatedAt(folders), maxUpdatedAt(tags));
  return max === -Infinity ? null : new Date(max).toISOString();
}
