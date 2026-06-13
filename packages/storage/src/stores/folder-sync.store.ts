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
   * Stable id of the top-level app folder this config imports into. The
   * DURABLE link between the on-disk directory and the app folder: because it
   * is an id, renaming the folder (in the folder tree OR in sync settings)
   * never breaks sync - the import keeps targeting the same node.
   *
   * Absent on records from the link-by-name era (before 2026-06-13) and on a
   * config whose first sync hasn't run yet. Resolved lazily - by name from the
   * current tree, then by creation - and persisted by `resolveTargetFolderId`
   * (`folder-sync.service.ts`); `refreshFolderSyncStatus` back-fills it from a
   * name match on load so the by-id folder marker works before a sync runs.
   */
  target_folder_id?: string;
  /**
   * Display label chosen at link time (defaults to the directory name), and
   * the name used to create/recreate the target folder. Since the link moved
   * to `target_folder_id`, this is NO LONGER the link: it is the creation name
   * and the settings fallback label. The live folder name (resolved by
   * `target_folder_id`) is what the UI shows when the folder exists, so a tree
   * rename is reflected even though this field stays put. It also roots the
   * walk's relative paths (`collectMarkdownEntries`), kept stable across tree
   * renames to avoid churning `known_paths`. Editable in settings, which
   * renames the target folder by id (see `updateFolderSyncConfig`).
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
