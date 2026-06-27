/**
 * A {@link BackupDestination} backed by the native FolderFs plugin: it writes
 * encrypted backups into the directory the user picked (outside the app
 * sandbox), reads them back for the self-test, and lists/removes them for
 * rotation. Native-only - web has no persistent unattended write target, so the
 * web path keeps `isConfigured()` false and the scheduler skips.
 *
 * NATIVE IMPL PENDING: this calls `writeFile`/`deleteFile` on the FolderFs
 * bridge, which still need their Swift/Android sides (and a WRITE permission
 * grant) - see `native-folder-fs.ts` and `planning/auto-backup-zk.md`. The TS
 * contract here is what those native methods must satisfy.
 */

import {
  isBackupFilename,
  parseBackupTimestamp,
  type BackupDestination,
  type BackupFile,
  type RebornApp
} from '@reborn/backup';
import { getFolderFs } from '$lib/utils/native-folder-fs';

const APP: RebornApp = 'reborn-notes';

/**
 * Build the native folder destination for a given bookmark. A missing bookmark
 * (folder not yet picked) yields a destination that reports "not configured",
 * so the scheduler skips cleanly rather than throwing.
 */
export function createNativeFolderDestination(bookmark: string | undefined): BackupDestination {
  return {
    async isConfigured(): Promise<boolean> {
      return __REBORN_NATIVE__ && typeof bookmark === 'string' && bookmark.length > 0;
    },

    async write(filename: string, blob: Blob): Promise<void> {
      await getFolderFs().writeFile({
        bookmark: bookmark as string,
        path: filename,
        content: await blob.text()
      });
    },

    async read(filename: string): Promise<string> {
      const { content } = await getFolderFs().readFile({
        bookmark: bookmark as string,
        path: filename
      });
      return content;
    },

    async list(): Promise<BackupFile[]> {
      const { files } = await getFolderFs().listFiles({
        bookmark: bookmark as string,
        extensions: ['json']
      });
      const out: BackupFile[] = [];
      for (const f of files) {
        // FolderFs paths are rooted at the directory leaf; our backups are flat,
        // so the basename is the filename we wrote.
        const name = f.path.split('/').pop() ?? f.path;
        if (!isBackupFilename(APP, name)) continue;
        // Prefer the timestamp encoded in the name; fall back to file mtime.
        const at = parseBackupTimestamp(APP, name) ?? (f.mtime ? new Date(f.mtime).toISOString() : '');
        out.push({ name, at });
      }
      return out;
    },

    async remove(filename: string): Promise<void> {
      await getFolderFs().deleteFile({ bookmark: bookmark as string, path: filename });
    }
  };
}
