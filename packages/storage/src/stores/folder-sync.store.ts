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
 * The list holds one record per linked directory (the app enforces a small
 * cap and same-directory dedup; see `folder-sync.service.ts`). Records
 * created by the single-folder v1 (`id = 'default'`) keep working unchanged.
 */
export interface FolderSyncConfigRecord extends WithId {
  id: string;
  /**
   * Persisted directory handle. Typed loosely so this package does not
   * depend on WICG File System Access typings; the app layer narrows it.
   * Cloneable into IndexedDB in Chromium (the only engine with the API).
   */
  handle: unknown;
  /**
   * Display name chosen at link time (defaults to the directory name).
   * Doubles as the list label and as the name of the top-level folder the
   * import targets, and is unique across configs (case-insensitive) so two
   * sources named "notes" can be told apart and land in two different
   * folders. Editable: renaming it renames that existing app folder in place
   * (see `updateFolderSyncConfig` in `folder-sync.service.ts`).
   */
  root_name: string;
  /**
   * Optional cosmetic label for the on-disk source directory. The File
   * System Access API exposes only the directory's leaf name (no full path),
   * so two folders both called "docs" are indistinguishable in the UI; this
   * lets the user annotate the source (e.g. with a path) to tell them apart.
   *
   * Display only - it never affects which directory is read (dedup is by
   * handle identity, not by name) and, like the rest of this record, never
   * leaves the browser profile. Absent/null = "use the on-disk leaf name".
   * Absent on records created before 2026-06-13.
   */
  source_label?: string | null;
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
