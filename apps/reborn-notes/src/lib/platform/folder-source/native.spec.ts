/**
 * Locks the native FolderSource's mapping onto the FolderFs plugin contract: the
 * lazy-entry shape, the stale-bookmark refresh, and - crucially - that the opaque
 * per-file handle (`id`, the Android SAF documentId) from `listFiles` is threaded
 * back into `readFile` so a changed file reads O(1) instead of re-walking the tree.
 *
 * `$lib/utils/native-folder-fs` is fully mocked, so the module's own
 * `__REBORN_NATIVE__` ("native-only") guard is never reached and this runs under
 * the vitest web define like every other native bridge spec.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakePlugin = {
  pickDirectory: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  isSameDirectory: vi.fn()
};

vi.mock('$lib/utils/native-folder-fs', () => ({
  getFolderFs: () => fakePlugin
}));

import { createNativeFolderSource } from './native';

describe('native FolderSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pick maps a picked bookmark to a ref', async () => {
    fakePlugin.pickDirectory.mockResolvedValue({ bookmark: 'content://tree/x', name: 'Vault' });
    const out = await createNativeFolderSource().pick();
    expect(out).toEqual({
      kind: 'picked',
      ref: { bookmark: 'content://tree/x', name: 'Vault' },
      name: 'Vault'
    });
  });

  it('pick reports cancellation when the picker is dismissed', async () => {
    fakePlugin.pickDirectory.mockResolvedValue({ cancelled: true });
    expect(await createNativeFolderSource().pick()).toEqual({ kind: 'cancelled' });
  });

  it('listMarkdown threads the SAF id into the lazy read and builds the File', async () => {
    fakePlugin.listFiles.mockResolvedValue({
      files: [{ path: 'Vault/sub/note.md', mtime: 111, size: 9, id: 'doc-42' }]
    });
    fakePlugin.readFile.mockResolvedValue({ content: '# hi', mtime: 111 });

    const { entries, refreshedRef } = await createNativeFolderSource().listMarkdown({
      bookmark: 'bm',
      name: 'Vault'
    });

    expect(refreshedRef).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0].relativePath).toBe('Vault/sub/note.md');
    expect(entries[0].lastModified).toBe(111);

    const file = await entries[0].getFile();
    expect(fakePlugin.readFile).toHaveBeenCalledWith({
      bookmark: 'bm',
      path: 'Vault/sub/note.md',
      id: 'doc-42'
    });
    expect(file.name).toBe('note.md');
    expect(file.lastModified).toBe(111);
    expect(await file.text()).toBe('# hi');
  });

  it('listMarkdown surfaces a stale bookmark as refreshedRef and reads with the fresh one', async () => {
    fakePlugin.listFiles.mockResolvedValue({
      files: [{ path: 'Vault/a.md', mtime: 5, size: 1, id: 'd1' }],
      staleBookmark: 'fresh-bm'
    });
    fakePlugin.readFile.mockResolvedValue({ content: 'x', mtime: 5 });

    const { entries, refreshedRef } = await createNativeFolderSource().listMarkdown({
      bookmark: 'old-bm',
      name: 'Vault'
    });

    expect(refreshedRef).toEqual({ bookmark: 'fresh-bm', name: 'Vault' });
    await entries[0].getFile();
    expect(fakePlugin.readFile).toHaveBeenCalledWith({
      bookmark: 'fresh-bm',
      path: 'Vault/a.md',
      id: 'd1'
    });
  });

  it('isSame delegates to the plugin and swallows bridge errors as false', async () => {
    const src = createNativeFolderSource();
    fakePlugin.isSameDirectory.mockResolvedValue({ same: true });
    expect(await src.isSame({ bookmark: 'a' }, { bookmark: 'b' })).toBe(true);
    fakePlugin.isSameDirectory.mockRejectedValue(new Error('boom'));
    expect(await src.isSame({ bookmark: 'a' }, { bookmark: 'b' })).toBe(false);
  });

  it('queryAccess is optimistically granted (native bookmarks resolve silently)', async () => {
    expect(await createNativeFolderSource().queryAccess({ bookmark: 'a' })).toBe('granted');
  });

  it('isSupported is always true on the native shell', () => {
    expect(createNativeFolderSource().isSupported()).toBe(true);
  });
});
