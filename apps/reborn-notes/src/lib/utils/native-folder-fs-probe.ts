/**
 * Dev-only native FolderFs probe (native folder sync, Faza 0 spike validation).
 * Native build only.
 *
 * Exposes `window.__rebornFolderFsProbe` so the security-scoped bookmark + iCloud
 * paths can be validated on REAL hardware (the parts the research could not confirm
 * without a device: bookmark survives relaunch/reboot, iCloud placeholder download,
 * empty-first-enumerate retry). Run from the Safari Web Inspector console
 * (Mac: Develop > <device> > the app webview):
 *
 *   await __rebornFolderFsProbe.pick()        // system picker; stores the bookmark
 *   await __rebornFolderFsProbe.list()        // recursive .md list (path + mtime + size)
 *   await __rebornFolderFsProbe.read()        // read first .md (or .read('<leaf>/sub/x.md'))
 *   // --- kill the app, REBOOT the device, relaunch, reopen the inspector ---
 *   await __rebornFolderFsProbe.list()        // must still work WITHOUT re-picking
 *   __rebornFolderFsProbe.clear()             // forget the stored bookmark
 *
 * The bookmark is stored in localStorage (probe-only key - NOT the real folder-sync
 * store) precisely so it survives a reboot for the test.
 *
 * Gated behind `__REBORN_NATIVE__`, so it is dead-code-eliminated from the web build.
 * Temporary - remove when the FolderSource refactor + UI land (it has served its
 * purpose by then), like native-auth-probe.ts.
 */
import { getFolderFs } from '$lib/utils/native-folder-fs';

const LS_KEY = '__rebornFolderFsProbe:bookmark';

export function installNativeFolderFsProbe(): void {
  if (!__REBORN_NATIVE__ || typeof window === 'undefined') return;

  const probe = {
    async pick() {
      const res = await getFolderFs().pickDirectory();
      if (res.cancelled || !res.bookmark) {
        console.log('[folderFsProbe] cancelled');
        return res;
      }
      localStorage.setItem(LS_KEY, res.bookmark);
      console.log(`[folderFsProbe] picked "${res.name}" - bookmark stored (survives reboot)`);
      return res;
    },

    async list() {
      const bookmark = localStorage.getItem(LS_KEY);
      if (!bookmark) {
        console.warn('[folderFsProbe] no bookmark - run pick() first');
        return null;
      }
      const res = await getFolderFs().listFiles({ bookmark, extensions: ['md'] });
      if (res.staleBookmark) {
        localStorage.setItem(LS_KEY, res.staleBookmark);
        console.log('[folderFsProbe] bookmark was STALE - refreshed and re-stored');
      }
      console.log(`[folderFsProbe] ${res.files.length} .md file(s)`);
      console.table(
        res.files.slice(0, 30).map((f) => ({
          path: f.path,
          mtime: f.mtime ? new Date(f.mtime).toISOString() : '(unknown)',
          size: f.size
        }))
      );
      return res;
    },

    async read(path?: string) {
      const bookmark = localStorage.getItem(LS_KEY);
      if (!bookmark) {
        console.warn('[folderFsProbe] no bookmark - run pick() first');
        return null;
      }
      let target = path;
      if (!target) {
        const { files } = await getFolderFs().listFiles({ bookmark, extensions: ['md'] });
        target = files[0]?.path;
      }
      if (!target) {
        console.warn('[folderFsProbe] no .md file to read');
        return null;
      }
      const res = await getFolderFs().readFile({ bookmark, path: target });
      console.log(
        `[folderFsProbe] read "${target}" - ${res.content.length} chars, mtime=${
          res.mtime ? new Date(res.mtime).toISOString() : '(unknown)'
        }`
      );
      console.log(res.content.slice(0, 800));
      return res;
    },

    clear() {
      localStorage.removeItem(LS_KEY);
      console.log('[folderFsProbe] stored bookmark cleared');
    }
  };

  (window as unknown as Record<string, unknown>).__rebornFolderFsProbe = probe;
}
