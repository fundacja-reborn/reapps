/**
 * Raw-bridge access to the app-local FolderFs native plugin (native folder sync).
 *
 * FolderFs gives the native shell persistent read access to a user-picked directory
 * OUTSIDE the app sandbox - the capability WKWebView/Android WebView lack (no File
 * System Access API). It is the native counterpart of the web
 * `FileSystemDirectoryHandle`: an opaque, persistable reference (a base64
 * security-scoped bookmark on iOS, a SAF tree-Uri string on Android) plus recursive
 * `.md` enumeration and lazy file reads. See `planning/native-folder-sync-plan.md`.
 *
 * Talks DIRECTLY to the natively-registered plugin via `registerPlugin('FolderFs')`
 * - the same raw-proxy pattern as `native-secure-storage.ts` / `native-system-bars.ts`
 * (no JS convenience layer, no nested dynamic import that could wedge boot). This is
 * NOT a boot-path module, but the pattern is kept for consistency and DCE.
 *
 * `@capacitor/core` is imported statically; on web, `registerPlugin` is referenced
 * only behind the compile-time-false `__REBORN_NATIVE__` guard, so the whole module
 * tree-shakes out of the web bundle.
 */

import { registerPlugin } from '@capacitor/core';

/** One file found by a native directory walk (metadata only; bytes read lazily). */
export interface NativeFsEntry {
  /** `<leaf>/<sub>/<file>.md`, rooted at the directory leaf name (web walk shape). */
  path: string;
  /** Last-modified, ms epoch. 0 = unknown (treated as "always changed"). */
  mtime: number;
  /** File size in bytes. */
  size: number;
  /**
   * Opaque platform handle to the file, threaded back into `readFile` so the
   * lazy read is O(1). Android: the SAF documentId (SAF Uris are NOT
   * path-addressable, so a documentId is the only cheap way back to the file).
   * iOS omits it - its URLs are path-addressable, so `readFile` resolves from
   * `path` alone.
   */
  id?: string;
}

/** Native FolderFs plugin method surface (see FolderFsPlugin.swift). */
export interface FolderFsPlugin {
  /** Present the system folder picker (user gesture). Resolves a base64 bookmark. */
  pickDirectory(): Promise<{ bookmark?: string; name?: string; cancelled?: boolean }>;
  /**
   * Recursively list files matching `extensions` (default `['md']`). Returns a
   * refreshed `staleBookmark` when the OS reported the stored bookmark stale -
   * persist it over the old one.
   */
  listFiles(options: {
    bookmark: string;
    extensions?: string[];
  }): Promise<{ files: NativeFsEntry[]; staleBookmark?: string }>;
  /**
   * Read one file's UTF-8 content (iOS downloads iCloud placeholders first).
   * `id` is the optional opaque handle from `listFiles` (Android SAF documentId);
   * iOS ignores it and resolves the file from `path`.
   */
  readFile(options: {
    bookmark: string;
    path: string;
    id?: string;
  }): Promise<{ content: string; mtime: number }>;
  /** Same on-disk directory? (dedup at link time). */
  isSameDirectory(options: { a: string; b: string }): Promise<{ same: boolean }>;
  /**
   * Write (create or overwrite) one UTF-8 file at `path` relative to the
   * bookmarked directory root. The automated backup engine uses this to drop an
   * encrypted backup envelope into the user-chosen folder (see
   * `planning/auto-backup-zk.md`). Returns a refreshed `staleBookmark` on the
   * same terms as {@link listFiles}.
   *
   * NATIVE IMPL PENDING: the read-only folder-sync picker only requests READ
   * access, so the Swift/Android sides must (a) re-pick or upgrade the grant to
   * include WRITE (`Intent.FLAG_GRANT_WRITE_URI_PERMISSION` + a persisted write
   * grant on Android; a writable security-scoped bookmark on iOS) and (b)
   * implement the coordinated write. Until then this rejects on device.
   */
  writeFile(options: {
    bookmark: string;
    path: string;
    content: string;
  }): Promise<{ staleBookmark?: string }>;
  /**
   * Delete one file at `path` relative to the bookmarked directory root, used by
   * backup rotation. `path` is the file's display name at the folder root (our
   * backups are flat); the Android side resolves it to a SAF documentId.
   *
   * NATIVE IMPL PENDING (same WRITE-grant prerequisite as {@link writeFile}).
   */
  deleteFile(options: { bookmark: string; path: string }): Promise<{ staleBookmark?: string }>;
}

let plugin: FolderFsPlugin | null = null;

/** The FolderFs plugin proxy. Throws on web builds (native-only capability). */
export function getFolderFs(): FolderFsPlugin {
  if (!__REBORN_NATIVE__) throw new Error('FolderFs is native-only');
  plugin ??= registerPlugin<FolderFsPlugin>('FolderFs');
  return plugin;
}
