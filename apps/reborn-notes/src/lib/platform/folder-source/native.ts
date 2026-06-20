/**
 * Native (Capacitor: iOS + Android) FolderSource - the app-local FolderFs plugin.
 *
 * The `DirectoryRef` is `{ bookmark, name }`: persistent read access to a
 * user-picked out-of-sandbox directory (iOS: a base64 security-scoped bookmark;
 * Android: a SAF tree-Uri string + takePersistableUriPermission) that survives
 * relaunch + reboot, plus the on-disk leaf name for display. The plugin
 * enumerates `.md` files (path + mtime + size, no content) and reads one file's
 * content on demand, so a sync run only reads the files that changed - the same
 * laziness the web File has.
 *
 * Loaded only on the native build (the selector in `./index.ts` picks this when
 * `__REBORN_NATIVE__` is true); on web this whole module - and the plugin behind
 * it - is dead-code-eliminated.
 */
import { getFolderFs } from '$lib/utils/native-folder-fs';
import type { AccessState, DirectoryRef, FolderSource, LazyMarkdownEntry, PickOutcome } from './types';

/** The native ref shape (opaque to the folder-sync service). */
type NativeRef = { bookmark: string; name: string };

function asRef(ref: DirectoryRef): NativeRef {
  return ref as NativeRef;
}

export function createNativeFolderSource(): FolderSource {
  return {
    isSupported(): boolean {
      // The plugin is compiled into the native shell; the feature is always
      // available there (unlike web, which needs the File System Access API).
      return true;
    },

    dirName(ref: DirectoryRef): string {
      return asRef(ref).name;
    },

    async pick(): Promise<PickOutcome> {
      const res = await getFolderFs().pickDirectory();
      if (res.cancelled || !res.bookmark || !res.name) return { kind: 'cancelled' };
      const ref: NativeRef = { bookmark: res.bookmark, name: res.name };
      return { kind: 'picked', ref, name: res.name };
    },

    async isSame(a: DirectoryRef, b: DirectoryRef): Promise<boolean> {
      try {
        const { same } = await getFolderFs().isSameDirectory({
          a: asRef(a).bookmark,
          b: asRef(b).bookmark
        });
        return same;
      } catch {
        return false;
      }
    },

    async queryAccess(): Promise<AccessState> {
      // A native security-scoped bookmark resolves silently and persistently -
      // there is no per-restart re-grant like the web. Report 'granted'
      // optimistically (cheap, and almost always true); a genuinely dead
      // bookmark - folder deleted/moved on disk - surfaces as a thrown
      // listMarkdown during the next sync, which the runner maps to
      // folder_gone / needs-permission. This avoids enumerating the whole
      // directory just to probe access on every status refresh.
      return 'granted';
    },

    async requestAccess(): Promise<{ state: AccessState; refreshedRef?: DirectoryRef }> {
      // No silent re-grant on native: a dead bookmark is fixed by re-linking
      // (a fresh pick), handled by the UI, not here. Access is otherwise always
      // granted (see queryAccess).
      return { state: 'granted' };
    },

    async listMarkdown(
      ref: DirectoryRef
    ): Promise<{ entries: LazyMarkdownEntry[]; refreshedRef?: DirectoryRef; skippedTooDeep?: number }> {
      const nref = asRef(ref);
      const { files, staleBookmark } = await getFolderFs().listFiles({
        bookmark: nref.bookmark,
        extensions: ['md']
      });
      // If the OS reported the bookmark stale, the plugin recreated it; use the
      // fresh one for the lazy reads below and hand it back to persist.
      const bookmark = staleBookmark ?? nref.bookmark;
      const entries: LazyMarkdownEntry[] = files.map((f) => ({
        relativePath: f.path,
        lastModified: f.mtime,
        getFile: async () => {
          // Pass the opaque handle through (Android SAF documentId -> O(1) read;
          // undefined on iOS, which resolves from `path`).
          const { content } = await getFolderFs().readFile({ bookmark, path: f.path, id: f.id });
          const name = f.path.split('/').pop() ?? f.path;
          return new File([content], name, { lastModified: f.mtime });
        }
      }));
      const refreshedRef: DirectoryRef | undefined = staleBookmark
        ? ({ bookmark, name: nref.name } satisfies NativeRef)
        : undefined;
      return { entries, refreshedRef };
    }
  };
}
