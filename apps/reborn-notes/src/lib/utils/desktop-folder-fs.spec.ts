/**
 * Locks the desktop FolderFs facade to the shell's command contract
 * (`src-tauri/src/folder_fs.rs`): command names and argument keys are plain
 * strings on both sides, and the error mapping decides which state the
 * folder-sync runner shows. A drift on one side only would surface as a
 * silently dead feature, not as a build error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDesktopFolderFs, toFolderError } from './desktop-folder-fs';

describe('desktop-folder-fs', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => ({}));
    globals.__TAURI__ = { core: { invoke } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  it('picks a read-only folder by default', async () => {
    invoke.mockResolvedValueOnce({ bookmark: 'token-1', name: 'Vault' });

    await expect(getDesktopFolderFs().pickDirectory()).resolves.toEqual({
      bookmark: 'token-1',
      name: 'Vault'
    });
    expect(invoke).toHaveBeenCalledWith('folder_fs_pick_directory', { write: false });
  });

  it('asks for a writable folder only when the caller does', async () => {
    await getDesktopFolderFs().pickDirectory({ write: true });

    expect(invoke).toHaveBeenCalledWith('folder_fs_pick_directory', { write: true });
  });

  it('passes a cancelled dialog through', async () => {
    invoke.mockResolvedValueOnce({ cancelled: true });

    await expect(getDesktopFolderFs().pickDirectory()).resolves.toEqual({ cancelled: true });
  });

  it('lists, reads, writes, deletes, compares and releases through the shell', async () => {
    const fs = getDesktopFolderFs();

    await fs.listFiles({ bookmark: 't', extensions: ['md'] });
    await fs.readFile({ bookmark: 't', path: 'Vault/a.md', id: 'ignored-on-desktop' });
    await fs.writeFile({ bookmark: 't', path: 'backup.json', content: '{}' });
    await fs.deleteFile({ bookmark: 't', path: 'backup.json' });
    await fs.isSameDirectory({ a: 't', b: 'u' });
    await fs.releaseDirectory({ bookmark: 't', write: true });

    expect(invoke.mock.calls).toEqual([
      ['folder_fs_list_files', { bookmark: 't', extensions: ['md'] }],
      ['folder_fs_read_file', { bookmark: 't', path: 'Vault/a.md' }],
      ['folder_fs_write_file', { bookmark: 't', path: 'backup.json', content: '{}' }],
      ['folder_fs_delete_file', { bookmark: 't', path: 'backup.json' }],
      ['folder_fs_is_same_directory', { a: 't', b: 'u' }],
      ['folder_fs_release_directory', { bookmark: 't' }]
    ]);
  });

  it('reports a vanished folder as NotFoundError, the runner cue for "folder gone"', async () => {
    invoke.mockRejectedValueOnce({ code: 'FOLDER_NOT_FOUND', message: 'gone' });

    const error = await getDesktopFolderFs()
      .listFiles({ bookmark: 't' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('NotFoundError');
  });

  it('keeps every other shell failure a plain Error with its code', async () => {
    invoke.mockRejectedValueOnce({ code: 'ACCESS_DENIED', message: 'No access to this folder' });

    const error = await getDesktopFolderFs()
      .readFile({ bookmark: 't', path: 'a.md' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ message: 'No access to this folder', code: 'ACCESS_DENIED' });
  });

  it('does not treat a missing file as a missing folder', () => {
    const error = toFolderError({ code: 'FILE_NOT_FOUND', message: 'The file no longer exists' });

    expect(error).not.toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('survives a rejection with no usable payload', () => {
    expect(toFolderError('boom')).toMatchObject({ message: 'Folder access failed', code: 'UNKNOWN' });
    expect(toFolderError(null)).toMatchObject({ code: 'UNKNOWN' });
    const original = new Error('desktop bridge unavailable');
    expect(toFolderError(original)).toBe(original);
  });
});
