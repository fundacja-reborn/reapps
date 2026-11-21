/**
 * FolderFs for the desktop (Tauri) shell: access to folders the user linked
 * through the system dialog, behind the shell's `folder_fs_*` commands
 * (`src-tauri/src/folder_fs.rs`).
 *
 * Same contract as the Capacitor plugin in `native-folder-fs.ts`, which hands
 * this implementation out on desktop builds - so folder sync
 * (`$lib/platform/folder-source/native.ts`) and the automated backup
 * (`$lib/services/auto-backup/`) work unchanged.
 *
 * The `bookmark` is a random token here, not a path: the shell keeps the
 * token -> folder mapping on its side and resolves every call against it, so
 * page code can only reach folders the user picked (see the trust model in
 * `folder_fs.rs`). A token never goes stale, so no `staleBookmark` is ever
 * returned.
 */

import { invokeDesktop } from './desktop-bridge';
import type { FolderFsPlugin, NativeFsEntry } from './native-folder-fs';

/** Error payload of a rejected `folder_fs_*` command. */
interface ShellFolderError {
  code?: unknown;
  message?: unknown;
}

/**
 * Turn a shell rejection into the error the callers already understand.
 *
 * A linked folder that was moved or deleted becomes a `NotFoundError`
 * DOMException - the folder-sync runner maps exactly that to its targeted
 * "folder gone" state (the web File System Access API throws the same). Every
 * other failure stays a plain Error carrying the shell's `code`.
 */
export function toFolderError(rejection: unknown): Error {
  if (rejection instanceof Error) return rejection;
  const payload: ShellFolderError =
    typeof rejection === 'object' && rejection !== null ? rejection : {};
  const code = typeof payload.code === 'string' ? payload.code : 'UNKNOWN';
  const message = typeof payload.message === 'string' ? payload.message : 'Folder access failed';
  if (code === 'FOLDER_NOT_FOUND') return new DOMException(message, 'NotFoundError');
  return Object.assign(new Error(message), { code });
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invokeDesktop<T>(command, args);
  } catch (rejection) {
    throw toFolderError(rejection);
  }
}

export function getDesktopFolderFs(): FolderFsPlugin {
  return {
    pickDirectory(options) {
      return call<{ bookmark?: string; name?: string; cancelled?: boolean }>(
        'folder_fs_pick_directory',
        { write: options?.write === true }
      );
    },

    listFiles({ bookmark, extensions }) {
      return call<{ files: NativeFsEntry[] }>('folder_fs_list_files', { bookmark, extensions });
    },

    readFile({ bookmark, path }) {
      return call<{ content: string; mtime: number }>('folder_fs_read_file', { bookmark, path });
    },

    isSameDirectory({ a, b }) {
      return call<{ same: boolean }>('folder_fs_is_same_directory', { a, b });
    },

    writeFile({ bookmark, path, content }) {
      return call<{ staleBookmark?: string }>('folder_fs_write_file', { bookmark, path, content });
    },

    deleteFile({ bookmark, path }) {
      return call<{ staleBookmark?: string }>('folder_fs_delete_file', { bookmark, path });
    },

    async releaseDirectory({ bookmark }) {
      await call<null>('folder_fs_release_directory', { bookmark });
    }
  };
}
