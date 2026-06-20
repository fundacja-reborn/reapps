/**
 * `FolderSource` - the platform-divergent capability behind live folder sync:
 * persistent read access to a user-picked on-disk directory of `.md` files, plus
 * a recursive, lazy markdown walk.
 *
 * Web (PWA, Chromium) implements it with the File System Access API
 * (`showDirectoryPicker` + `FileSystemDirectoryHandle`); the native shell
 * (Capacitor, iOS) implements it with the app-local FolderFs plugin (a
 * security-scoped bookmark). The folder-sync service talks only to this
 * interface, so the multi-config runner, manifest, watermark, dedup and import
 * engine are shared verbatim across platforms.
 *
 * App-local (not in `@reborn/platform`) on purpose: Notes is the only consumer,
 * the web impl pulls in WICG File System Access typings, and the native walker
 * has a different shape than the other platform capabilities - mirrors the 3a
 * "native impl app-local, promote when a 2nd app consumes it" decision. See
 * `planning/native-folder-sync-plan.md`.
 */

/**
 * Opaque, IndexedDB-persistable reference to a linked directory. The folder-sync
 * service treats it as a black box and stores it in the config record's `handle`
 * field; only the FolderSource impl knows its real shape:
 *  - Web: a `FileSystemDirectoryHandle` (structured-cloneable into IndexedDB).
 *  - Native: `{ bookmark: string (base64 security-scoped bookmark), name: string }`.
 *
 * Web and native never share a browser profile / install, so the same field
 * holding two shapes needs no migration.
 */
export type DirectoryRef = unknown;

/**
 * One markdown file found by a directory walk. Content is read LAZILY via
 * `getFile()` so a sync run only materializes the (few) files that passed the
 * mtime/known-path filter - critical on native, where reading the whole vault
 * every scan would be ruinous. `lastModified` is metadata, available without
 * reading bytes, so the filter runs cheaply.
 */
export interface LazyMarkdownEntry {
  /** `<leaf>/<sub>/<file>.md`, rooted at the on-disk directory leaf name (the
   *  shape a `webkitdirectory` input produces, so the import engine is blind to
   *  which platform produced it). */
  relativePath: string;
  /** Last-modified time, ms since epoch. 0 = unknown (treated as always-changed). */
  lastModified: number;
  /** Materialize the file. Web: the handle's already-fetched (lazy) File. Native:
   *  a File built from a one-shot bridge read of the file's content. */
  getFile(): Promise<File>;
}

/** Read-access state for a linked directory, mirroring `PermissionState`. */
export type AccessState = 'granted' | 'prompt' | 'denied';

/** Outcome of the directory picker step (must be triggered by a user gesture). */
export type PickOutcome =
  | { kind: 'picked'; ref: DirectoryRef; name: string }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' };

export interface FolderSource {
  /** Whether linked folder sync is available on this platform/runtime. */
  isSupported(): boolean;
  /** On-disk leaf name of the directory, for display (synchronous). */
  dirName(ref: DirectoryRef): string;
  /** Open the system directory picker. MUST be called from a user gesture. */
  pick(): Promise<PickOutcome>;
  /** Whether two refs point at the same on-disk directory (link-time dedup). */
  isSame(a: DirectoryRef, b: DirectoryRef): Promise<boolean>;
  /** Non-prompting access probe. */
  queryAccess(ref: DirectoryRef): Promise<AccessState>;
  /**
   * Prompting access request (user gesture; manual runs only). May return a
   * `refreshedRef` the caller must persist (web: unchanged; native: re-pick flow
   * is handled separately, so this is effectively a re-probe).
   */
  requestAccess(ref: DirectoryRef): Promise<{ state: AccessState; refreshedRef?: DirectoryRef }>;
  /**
   * Recursively list `.md` files under the directory, content lazy. May return a
   * `refreshedRef` to persist (native: the OS reported the bookmark stale and we
   * recreated it). `skippedTooDeep` counts subtrees past the depth cap (web only).
   */
  listMarkdown(
    ref: DirectoryRef
  ): Promise<{ entries: LazyMarkdownEntry[]; refreshedRef?: DirectoryRef; skippedTooDeep?: number }>;
}
