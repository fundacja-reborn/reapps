import { IndexedDBStore } from '../core/store';
import type { WithId } from '../core/types';

/**
 * Live folder sync configuration for the RebornNotes application.
 *
 * Each record links a local on-disk directory (via a persisted File System
 * Access API `FileSystemDirectoryHandle`) to the user's notes: the app
 * re-scans the directory and re-imports changed `.md` files client-side.
 *
 * Device-local by design - a directory handle is a browser capability object
 * that cannot leave this browser profile. Records are structured-cloned into
 * IndexedDB (handles are cloneable but NOT JSON-serializable), are never
 * synced to the server, and are cleared on logout like all user data.
 *
 * The schema is a list keyed by `id` for forward-compatibility, but the v1
 * UI maintains at most one record (see `folder-sync.service.ts` in the app).
 */
export interface FolderSyncConfigRecord extends WithId {
  id: string;
  /**
   * Persisted directory handle. Typed loosely so this package does not
   * depend on WICG File System Access typings; the app layer narrows it.
   * Cloneable into IndexedDB in Chromium (the only engine with the API).
   */
  handle: unknown;
  /** Directory name at pick time - import root folder name + display label. */
  root_name: string;
  /** Auto-sync (on app focus + periodic interval) enabled. */
  auto_sync: 0 | 1;
  /**
   * ISO timestamp of the start of the last completed scan. Next scan only
   * reads files with `lastModified` newer than this (minus a safety margin),
   * which is what keeps re-scans of large vaults cheap.
   */
  last_sync_at: string | null;
  /**
   * Relative paths (`<root>/<sub>/<file.md>`) of every markdown file seen by
   * the last completed scan. Complements the mtime watermark: a path NOT in
   * this set is new to the directory and always imports, regardless of its
   * mtime - files copied or moved in keep their original (often old)
   * modification date, which the watermark alone would silently skip.
   *
   * Absent on records created before 2026-06-13; absence = "unknown", which
   * makes the next run consider every file (cheap - the overwrite strategy's
   * unchanged-skip drops files that already match) and then populates it.
   */
  known_paths?: string[];
  /** Compact summary of the last completed run, for the settings UI. */
  last_result: {
    scanned: number;
    imported: number;
    unchanged: number;
    errors: number;
  } | null;
  created_at: string;
}

export const folderSyncStore = new IndexedDBStore<FolderSyncConfigRecord>({
  storeName: 'folderSyncConfigs'
});
