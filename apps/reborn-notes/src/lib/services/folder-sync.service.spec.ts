import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { FolderSyncConfigRecord } from '@reborn/storage';

// ── Module mocks ─────────────────────────────────────────────────────────
// The service is exercised against an in-memory config store and a stubbed
// importFolder; directory handles are plain fakes satisfying the structural
// slice the service touches (no real File System Access API in vitest).

const rows: FolderSyncConfigRecord[] = [];
// Live notes in local storage, by id - the existence source the deletion check
// reads via noteStore.getAll(). A test removes an id to model an in-app delete.
const noteRows: Array<{ id: string }> = [];

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('@reborn/storage', () => ({
  folderSyncStore: {
    get: async (id: string) => rows.find((r) => r.id === id) ?? null,
    getAll: async () => [...rows],
    save: async (row: FolderSyncConfigRecord) => {
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
    },
    delete: async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    }
  },
  noteStore: {
    // liveNoteIds() reads the metadata projection (DB v14 split) - ids only.
    getAllMeta: async () => [...noteRows]
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ isAuthenticated: true, hasE2E: true }) };
});

const refreshSpy = vi.fn();
vi.mock('$lib/stores/notes.store', () => ({ notesStore: { refresh: refreshSpy } }));
vi.mock('$lib/stores/tags.store', () => ({ tagsStore: { refresh: refreshSpy } }));

// foldersStore is a real-ish fake: the service reads the folder tree via
// `get(foldersStore)` and resolves/creates/moves/renames folders by id.
type FakeFolder = { id: string; name: string; parent_id?: string | null };
type FakeFolderNode = FakeFolder & { children: FakeFolderNode[] };
const folderRows: FakeFolder[] = [];
// Build the nested tree the real getFolderTree returns (the service walks
// `children` for path resolution) from the flat parent_id rows.
function buildFolderTree(flat: FakeFolder[]): FakeFolderNode[] {
  const byId = new Map(flat.map((r) => [r.id, { ...r, children: [] as FakeFolderNode[] }]));
  const roots: FakeFolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
const renameSpy = vi.fn(async (id: string, name: string) => {
  const f = folderRows.find((r) => r.id === id);
  if (f) f.name = name;
});
const createSpy = vi.fn(async (name: string, parentId?: string | null) => {
  const id = `created-${folderRows.length + 1}`;
  folderRows.push({ id, name, parent_id: parentId ?? null });
  return id;
});
const moveSpy = vi.fn(async (id: string, newParentId: string | null) => {
  const f = folderRows.find((r) => r.id === id);
  if (f) f.parent_id = newParentId ?? null;
});
vi.mock('$lib/stores/folders.store', async () => {
  const { writable } = await import('svelte/store');
  const tree = writable<FakeFolderNode[]>([]);
  return {
    foldersStore: {
      subscribe: tree.subscribe,
      refresh: async () => tree.set(buildFolderTree(folderRows)),
      rename: renameSpy,
      create: createSpy,
      move: moveSpy
    }
  };
});

// Concurrency tracker: the runner must never overlap two imports.
let activeImports = 0;
let maxActiveImports = 0;
type ImportCall = {
  paths: string[];
  targetFolderId?: string;
  pathManifest?: Record<string, string>;
  rewriteInterNoteLinks?: boolean;
};
const importCalls: ImportCall[] = [];

vi.mock('./export-import.service', () => ({
  importFolder: vi.fn(
    async (
      entries: Array<{ file: File; relativePath: string }>,
      _strategy?: unknown,
      _onProgress?: unknown,
      opts?: {
        targetFolderId?: string;
        pathManifest?: Record<string, string>;
        rewriteInterNoteLinks?: boolean;
      }
    ) => {
      activeImports++;
      maxActiveImports = Math.max(maxActiveImports, activeImports);
      importCalls.push({
        paths: entries.map((e) => e.relativePath),
        targetFolderId: opts?.targetFolderId,
        pathManifest: opts?.pathManifest,
        rewriteInterNoteLinks: opts?.rewriteInterNoteLinks
      });
      // Yield twice so an accidentally-parallel runner would overlap here.
      await Promise.resolve();
      await Promise.resolve();
      activeImports--;
      return {
        imported: entries.length,
        foldersCreated: 0,
        tagsCreated: 0,
        skippedNonMarkdown: 0,
        skippedTooLarge: 0,
        skippedHidden: 0,
        duplicatesSkipped: 0,
        duplicatesOverwritten: 0,
        duplicatesRenamed: 0,
        duplicatesUnchanged: 0,
        strippedCount: 0,
        errors: [],
        // Mirror the real importer: each input path resolves to a note id. A
        // deterministic id per path lets tests assert the persisted manifest.
        pathToNoteId: Object.fromEntries(entries.map((e) => [e.relativePath, `note:${e.relativePath}`]))
      };
    }
  )
}));

// Folder sync defers its folder creates/moves/renames (skipSync) and fires ONE
// ordered pushPendingItems() so a child folder never pushes before its
// freshly-created parent (server 404 "Parent folder not found"). Mock it as a
// spy to assert the flush fires, without loading the real sync transport.
const pushPendingItemsSpy = vi.fn(async () => {});
vi.mock('./notes-sync.service', () => ({ pushPendingItems: pushPendingItemsSpy }));

// ── Fakes ────────────────────────────────────────────────────────────────

type FakeDirOptions = {
  perm?: PermissionState;
  /** Thrown from the directory walk (e.g. NotFoundError = folder gone). */
  walkError?: Error;
  isSameEntry?: (other: unknown) => Promise<boolean>;
};

function fakeDir(name: string, files: string[], opts: FakeDirOptions = {}) {
  return {
    kind: 'directory' as const,
    name,
    queryPermission: async () => opts.perm ?? ('granted' as PermissionState),
    requestPermission: async () => opts.perm ?? ('granted' as PermissionState),
    isSameEntry: opts.isSameEntry ?? (async () => false),
    values: async function* () {
      if (opts.walkError) throw opts.walkError;
      for (const f of files) {
        yield {
          kind: 'file' as const,
          name: f,
          getFile: async () => new File(['# content'], f, { lastModified: 1_000 })
        };
      }
    }
  };
}

function seedConfig(
  partial: Partial<FolderSyncConfigRecord> & { id: string; handle: unknown }
): FolderSyncConfigRecord {
  const row: FolderSyncConfigRecord = {
    root_name: partial.id,
    auto_sync: 1,
    last_sync_at: null,
    last_result: null,
    created_at: `2026-06-0${rows.length + 1}T00:00:00.000Z`,
    ...partial
  };
  rows.push(row);
  return row;
}

async function loadService() {
  // Fresh module per test: the runner keeps per-tab state (single-flight
  // flag, auto cooldown) that must not leak between tests.
  return await import('./folder-sync.service');
}

beforeEach(() => {
  vi.resetModules();
  rows.length = 0;
  noteRows.length = 0;
  importCalls.length = 0;
  activeImports = 0;
  maxActiveImports = 0;
  folderRows.length = 0;
  renameSpy.mockClear();
  createSpy.mockClear();
  moveSpy.mockClear();
  pushPendingItemsSpy.mockClear();
  refreshSpy.mockReset();
  vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible' });
});

// ── Runner ───────────────────────────────────────────────────────────────

describe('runFolderSync (multi-config)', () => {
  it('syncs every config sequentially - imports never overlap', async () => {
    seedConfig({ id: 'a', handle: fakeDir('dir-a', ['a.md']) });
    seedConfig({ id: 'b', handle: fakeDir('dir-b', ['b.md']) });
    seedConfig({ id: 'c', handle: fakeDir('dir-c', ['c.md']) });
    const svc = await loadService();

    await svc.runFolderSync('manual', undefined);

    expect(importCalls).toHaveLength(3);
    expect(maxActiveImports).toBe(1);
  });

  it('roots import paths at the on-disk dir name, decoupled from the destination path', async () => {
    // root_name is now the destination (may be a "/"-path), so the walk roots
    // at handle.name instead - importFolder strips that single first segment
    // and anchors the subtree under the resolved target id.
    seedConfig({
      id: 'a',
      root_name: 'Notes/Work',
      handle: fakeDir('notes', ['a.md'])
    });
    const svc = await loadService();

    await svc.runFolderSync('manual');

    expect(importCalls[0].paths).toEqual(['notes/a.md']);
  });

  it('creates the target folder on first sync and anchors the import by its id', async () => {
    seedConfig({ id: 'a', root_name: 'Notes (work)', handle: fakeDir('notes', ['a.md']) });
    const svc = await loadService();

    await svc.runFolderSync('manual');

    // No folder existed -> resolveTargetFolderId created one and the import
    // anchored under its id (keepRootFolder off), not by name.
    expect(createSpy).toHaveBeenCalledWith('Notes (work)', undefined, { skipSync: true });
    expect(importCalls[0].targetFolderId).toBe('created-1');
    // The resolved link is persisted so future runs reuse the same folder.
    expect(rows.find((r) => r.id === 'a')?.target_folder_id).toBe('created-1');
  });

  it('links by folder id - a renamed target folder still syncs into it', async () => {
    // The on-disk root_name no longer matches the folder name (user renamed it
    // in the tree), but the id link survives: the import targets f1 regardless.
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      target_folder_id: 'f1',
      handle: fakeDir('docs', ['a.md'])
    });
    folderRows.push({ id: 'f1', name: 'Renamed by user', parent_id: null });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    await svc.runFolderSync('manual', 'a');

    expect(createSpy).not.toHaveBeenCalled();
    expect(importCalls[0].targetFolderId).toBe('f1');
    // Marker keys off the id, so it follows the rename.
    expect(get(svc.syncedFolderConfigs).get('f1')).toBe('a');
  });

  it('isolates a broken directory - the remaining configs still sync', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']) });
    seedConfig({
      id: 'b',
      root_name: 'B',
      handle: fakeDir('b', [], {
        walkError: new DOMException('gone', 'NotFoundError')
      })
    });
    seedConfig({ id: 'c', root_name: 'C', handle: fakeDir('c', ['c.md']) });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    await svc.runFolderSync('manual');

    expect(importCalls.map((c) => c.paths[0])).toEqual(['a/a.md', 'c/c.md']);
    const statuses = get(svc.folderSyncStatus);
    expect(statuses.find((s) => s.id === 'b')?.state).toBe('error');
    expect(statuses.find((s) => s.id === 'b')?.errorKey).toBe('folder_gone');
    expect(statuses.find((s) => s.id === 'a')?.state).toBe('idle');
    expect(statuses.find((s) => s.id === 'c')?.state).toBe('idle');
    // Healthy configs advanced their watermark; the broken one did not.
    expect(rows.find((r) => r.id === 'a')?.last_sync_at).not.toBeNull();
    expect(rows.find((r) => r.id === 'b')?.last_sync_at).toBeNull();
    expect(rows.find((r) => r.id === 'c')?.last_sync_at).not.toBeNull();
  });

  it('skips configs without permission instead of failing the run', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md'], { perm: 'prompt' }) });
    seedConfig({ id: 'b', root_name: 'B', handle: fakeDir('b', ['b.md']) });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    // Auto runs never prompt - config "a" records needs-permission.
    await svc.runFolderSync('auto');

    expect(importCalls.map((c) => c.paths[0])).toEqual(['b/b.md']);
    expect(get(svc.folderSyncStatus).find((s) => s.id === 'a')?.state).toBe('needs-permission');
  });

  it('auto runs cover only configs with auto-sync enabled', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']), auto_sync: 0 });
    seedConfig({ id: 'b', root_name: 'B', handle: fakeDir('b', ['b.md']) });
    const svc = await loadService();

    await svc.runFolderSync('auto');

    expect(importCalls.map((c) => c.paths[0])).toEqual(['b/b.md']);
  });

  it('manual run with a config id targets only that config', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']) });
    seedConfig({ id: 'b', root_name: 'B', handle: fakeDir('b', ['b.md']) });
    const svc = await loadService();

    const result = await svc.runFolderSync('manual', 'b');

    expect(importCalls.map((c) => c.paths[0])).toEqual(['b/b.md']);
    expect(result?.imported).toBe(1);
    expect(rows.find((r) => r.id === 'a')?.last_sync_at).toBeNull();
  });

  it('is single-flight per tab - a second call while running is a no-op', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']) });
    const svc = await loadService();

    const [first, second] = await Promise.all([
      svc.runFolderSync('manual'),
      svc.runFolderSync('manual')
    ]);

    expect(importCalls).toHaveLength(1);
    expect(first?.imported).toBe(1);
    expect(second).toBeNull();
  });

  it('applies the auto cooldown between automatic runs', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']) });
    const svc = await loadService();

    await svc.runFolderSync('auto');
    await svc.runFolderSync('auto');

    expect(importCalls).toHaveLength(1);
  });
});

// ── In-app deletion re-import (disk→app existence mirror) ──────────────────

describe('runFolderSync (in-app deletion)', () => {
  it('re-imports a file whose note was deleted in the app, despite an unchanged mtime', async () => {
    // Config already synced once: both files are known, recorded in the
    // manifest, and their mtime predates the watermark (unchanged on disk).
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      target_folder_id: 'f1',
      handle: fakeDir('Docs', ['a.md', 'b.md']),
      last_sync_at: '2026-06-12T00:00:00.000Z',
      known_paths: ['Docs/a.md', 'Docs/b.md'],
      path_note_ids: { 'Docs/a.md': 'note-a', 'Docs/b.md': 'note-b' }
    });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    // note-a was deleted in the app (and emptied from trash); note-b survives.
    noteRows.push({ id: 'note-b' });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    await svc.runFolderSync('manual', 'a');

    // Only the orphaned file is re-imported; the still-present note is untouched.
    expect(importCalls).toHaveLength(1);
    expect(importCalls[0].paths).toEqual(['Docs/a.md']);
    // The manifest refreshes a.md to its recreated note and keeps b.md.
    expect(rows.find((r) => r.id === 'a')?.path_note_ids).toEqual({
      'Docs/a.md': 'note:Docs/a.md',
      'Docs/b.md': 'note-b'
    });
  });

  it('leaves an unchanged file alone when its note still exists (cheap steady state)', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      target_folder_id: 'f1',
      handle: fakeDir('Docs', ['a.md']),
      last_sync_at: '2026-06-12T00:00:00.000Z',
      known_paths: ['Docs/a.md'],
      path_note_ids: { 'Docs/a.md': 'note-a' }
    });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    noteRows.push({ id: 'note-a' });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    await svc.runFolderSync('manual', 'a');

    expect(importCalls).toHaveLength(0);
    // The manifest carries the existing id across a no-op run.
    expect(rows.find((r) => r.id === 'a')?.path_note_ids).toEqual({ 'Docs/a.md': 'note-a' });
  });

  it('reconciles every file once to populate the manifest for a pre-manifest record', async () => {
    // No path_note_ids (record predates the manifest) but a watermark + known
    // paths exist: without the one-off full pass the unchanged file would be
    // skipped and never enter the manifest, leaving the deletion check blind.
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      target_folder_id: 'f1',
      handle: fakeDir('Docs', ['a.md']),
      last_sync_at: '2026-06-12T00:00:00.000Z',
      known_paths: ['Docs/a.md']
    });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    noteRows.push({ id: 'note-a' });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    await svc.runFolderSync('manual', 'a');

    expect(importCalls[0].paths).toEqual(['Docs/a.md']);
    expect(rows.find((r) => r.id === 'a')?.path_note_ids).toEqual({
      'Docs/a.md': 'note:Docs/a.md'
    });
  });

  it('passes the prior path-to-note manifest to importFolder so a stale title index cannot duplicate', async () => {
    // a.md is known and already linked to note-a. Its mtime (fakeDir stamps
    // 1000ms) is past the watermark, so it re-enters the incremental set and
    // reaches importFolder - which must receive the manifest to overwrite
    // note-a in place rather than trust the volatile in-memory title index.
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      target_folder_id: 'f1',
      handle: fakeDir('Docs', ['a.md']),
      last_sync_at: '1970-01-01T00:00:00.000Z',
      known_paths: ['Docs/a.md'],
      path_note_ids: { 'Docs/a.md': 'note-a' }
    });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    noteRows.push({ id: 'note-a' });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    await svc.runFolderSync('manual', 'a');

    expect(importCalls).toHaveLength(1);
    expect(importCalls[0].paths).toEqual(['Docs/a.md']);
    expect(importCalls[0].pathManifest).toEqual({ 'Docs/a.md': 'note-a' });
  });
});

// ── Add-folder flow ──────────────────────────────────────────────────────

describe('pickFolderToLink', () => {
  it('rejects a directory that is already linked (isSameEntry)', async () => {
    const linked = fakeDir('docs', []);
    seedConfig({ id: 'a', root_name: 'Docs', handle: linked });
    const picked = fakeDir('docs', [], {
      isSameEntry: async (other) => other === linked
    });
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn(async () => picked) });
    const svc = await loadService();

    const outcome = await svc.pickFolderToLink();

    expect(outcome).toEqual({ kind: 'already-linked', name: 'Docs' });
  });

  it('rejects when the config cap is reached', async () => {
    const svc = await loadService();
    for (let i = 0; i < svc.MAX_FOLDER_SYNC_CONFIGS; i++) {
      seedConfig({ id: `cfg-${i}`, handle: fakeDir(`d${i}`, []) });
    }
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => fakeDir('extra', []))
    });

    const outcome = await svc.pickFolderToLink();

    expect(outcome).toEqual({ kind: 'limit-reached' });
  });

  it('treats a dismissed picker as a plain cancel', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => {
        throw new DOMException('dismissed', 'AbortError');
      })
    });
    const svc = await loadService();

    expect(await svc.pickFolderToLink()).toEqual({ kind: 'cancelled' });
  });
});

describe('addLinkedFolder', () => {
  it('rejects a display name already used by another config (case-insensitive)', async () => {
    seedConfig({ id: 'a', root_name: 'Notes', handle: fakeDir('notes', []) });
    const svc = await loadService();

    const outcome = await svc.addLinkedFolder(
      fakeDir('other', []) as unknown as FileSystemDirectoryHandle,
      '  nOtEs '
    );

    expect(outcome).toEqual({ ok: false, error: 'name-taken' });
    expect(rows).toHaveLength(1);
  });

  it('rejects an empty name and the over-cap add', async () => {
    const svc = await loadService();
    expect(
      await svc.addLinkedFolder(fakeDir('x', []) as unknown as FileSystemDirectoryHandle, '   ')
    ).toEqual({ ok: false, error: 'name-empty' });

    for (let i = 0; i < svc.MAX_FOLDER_SYNC_CONFIGS; i++) {
      seedConfig({ id: `cfg-${i}`, handle: fakeDir(`d${i}`, []) });
    }
    expect(
      await svc.addLinkedFolder(fakeDir('x', []) as unknown as FileSystemDirectoryHandle, 'X')
    ).toEqual({ ok: false, error: 'limit-reached' });
  });

  it('rejects a destination containing a backslash (a forward slash now nests)', async () => {
    const svc = await loadService();
    expect(
      await svc.addLinkedFolder(
        fakeDir('docs', []) as unknown as FileSystemDirectoryHandle,
        'a\\b'
      )
    ).toEqual({ ok: false, error: 'name-invalid' });
    expect(rows).toHaveLength(0);
  });

  it('accepts a "/"-path and stores it normalized (leading/trailing/doubled slashes dropped)', async () => {
    const svc = await loadService();
    const outcome = await svc.addLinkedFolder(
      fakeDir('docs', []) as unknown as FileSystemDirectoryHandle,
      '  /Projekty//Docs/  '
    );
    expect(outcome.ok).toBe(true);
    expect(rows[0].root_name).toBe('Projekty/Docs');
  });

  it('resolves a "/"-path on first sync - find-or-creates the chain, anchors by the leaf id', async () => {
    const svc = await loadService();
    const added = await svc.addLinkedFolder(
      fakeDir('docs-src', ['a.md']) as unknown as FileSystemDirectoryHandle,
      'Projekty/Docs'
    );
    if (!added.ok) throw new Error('add should have succeeded');

    await svc.runFolderSync('manual', added.id);

    // Parent created at the top level, then the leaf under it; the import
    // anchors under the leaf id (not the parent), and the link persists.
    expect(createSpy).toHaveBeenNthCalledWith(1, 'Projekty', undefined, { skipSync: true });
    expect(createSpy).toHaveBeenNthCalledWith(2, 'Docs', 'created-1', { skipSync: true });
    expect(importCalls[0].targetFolderId).toBe('created-2');
    expect(rows[0].target_folder_id).toBe('created-2');
    expect(folderRows.find((f) => f.id === 'created-2')?.parent_id).toBe('created-1');
  });

  it('treats same-leaf destinations under different parents as distinct, identical paths as taken', async () => {
    seedConfig({ id: 'a', root_name: 'Projekty/Docs', handle: fakeDir('p1', []) });
    const svc = await loadService();

    // Same leaf "Docs" but a different parent path -> a different folder.
    expect(
      (
        await svc.addLinkedFolder(
          fakeDir('p2', []) as unknown as FileSystemDirectoryHandle,
          'Other/Docs'
        )
      ).ok
    ).toBe(true);
    // The exact same path (case-insensitive) -> would target the same folder.
    expect(
      await svc.addLinkedFolder(
        fakeDir('p3', []) as unknown as FileSystemDirectoryHandle,
        'projekty/docs'
      )
    ).toEqual({ ok: false, error: 'name-taken' });
  });

  it('saves a trimmed record with auto-sync on and reports it in the status list', async () => {
    const svc = await loadService();

    const outcome = await svc.addLinkedFolder(
      fakeDir('vault', []) as unknown as FileSystemDirectoryHandle,
      '  My vault  '
    );

    expect(outcome.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].root_name).toBe('My vault');
    expect(rows[0].auto_sync).toBe(1);
    expect(rows[0].last_sync_at).toBeNull();
    const statuses = get(svc.folderSyncStatus);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].name).toBe('My vault');
    expect(statuses[0].dirName).toBe('vault');
    expect(statuses[0].sourceLabel).toBeNull();
  });
});

describe('updateFolderSyncConfig', () => {
  it('sets a trimmed cosmetic source label without touching the destination or scan state', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      handle: fakeDir('docs', []),
      last_sync_at: '2026-06-12T00:00:00.000Z',
      known_paths: ['Docs/a.md']
    });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: '  fenster-laravel/docs  ',
      destName: 'Docs'
    });

    expect(outcome).toEqual({ ok: true });
    const row = rows.find((r) => r.id === 'a')!;
    expect(row.source_label).toBe('fenster-laravel/docs');
    expect(row.root_name).toBe('Docs');
    // Destination unchanged -> watermark and known paths survive.
    expect(row.last_sync_at).toBe('2026-06-12T00:00:00.000Z');
    expect(row.known_paths).toEqual(['Docs/a.md']);
    expect(renameSpy).not.toHaveBeenCalled();
    // Destination unchanged -> no folder surgery, so no ordered push fires.
    expect(pushPendingItemsSpy).not.toHaveBeenCalled();
    expect(get(svc.folderSyncStatus).find((s) => s.id === 'a')?.sourceLabel).toBe(
      'fenster-laravel/docs'
    );
  });

  it('clears the source label when blank (UI falls back to the on-disk name)', async () => {
    seedConfig({ id: 'a', root_name: 'Docs', handle: fakeDir('docs', []), source_label: 'old' });
    const svc = await loadService();

    await svc.updateFolderSyncConfig('a', { sourceLabel: '   ', destName: 'Docs' });

    expect(rows.find((r) => r.id === 'a')?.source_label).toBeNull();
  });

  it('renames the existing top-level app folder and resets scan state on a destination change', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      handle: fakeDir('docs', []),
      last_sync_at: '2026-06-12T00:00:00.000Z',
      known_paths: ['Docs/a.md']
    });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'Reapps Docs'
    });

    expect(outcome).toEqual({ ok: true });
    expect(renameSpy).toHaveBeenCalledWith('f1', 'Reapps Docs', { skipSync: true });
    expect(folderRows[0].name).toBe('Reapps Docs');
    const row = rows.find((r) => r.id === 'a')!;
    expect(row.root_name).toBe('Reapps Docs');
    // The link is captured by id (migrated from the matched-by-name folder).
    expect(row.target_folder_id).toBe('f1');
    // Renaming invalidates the path-prefixed known set and the mtime watermark.
    expect(row.last_sync_at).toBeNull();
    expect(row.known_paths).toBeUndefined();
  });

  it('renames the linked folder by id even when another top-level folder shares the new name', async () => {
    // Link-by-id makes this safe (the import no longer find-or-creates the
    // target by name), so the old dest-folder-exists rejection is gone.
    seedConfig({ id: 'a', root_name: 'Docs', target_folder_id: 'f1', handle: fakeDir('docs', []) });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    folderRows.push({ id: 'f2', name: 'Archive', parent_id: null });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'Archive'
    });

    expect(outcome).toEqual({ ok: true });
    expect(renameSpy).toHaveBeenCalledWith('f1', 'Archive', { skipSync: true });
    expect(rows.find((r) => r.id === 'a')?.root_name).toBe('Archive');
    expect(rows.find((r) => r.id === 'a')?.target_folder_id).toBe('f1');
  });

  it('rejects a destination name already used by another config (case-insensitive)', async () => {
    seedConfig({ id: 'a', root_name: 'Docs', handle: fakeDir('docs', []) });
    seedConfig({ id: 'b', root_name: 'Notes', handle: fakeDir('notes', []) });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: '  nOtEs '
    });

    expect(outcome).toEqual({ ok: false, error: 'name-taken' });
    expect(rows.find((r) => r.id === 'a')?.root_name).toBe('Docs');
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it('still updates the config and resets scan state when no app folder matches', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Ghost',
      handle: fakeDir('ghost', []),
      last_sync_at: '2026-06-12T00:00:00.000Z'
    });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'Reborn'
    });

    expect(outcome).toEqual({ ok: true });
    expect(renameSpy).not.toHaveBeenCalled();
    const row = rows.find((r) => r.id === 'a')!;
    expect(row.root_name).toBe('Reborn');
    expect(row.last_sync_at).toBeNull();
  });

  it('rejects a destination containing a backslash (a forward slash now nests)', async () => {
    seedConfig({ id: 'a', root_name: 'Docs', handle: fakeDir('docs', []) });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'a\\b'
    });

    expect(outcome).toEqual({ ok: false, error: 'name-invalid' });
    expect(rows.find((r) => r.id === 'a')?.root_name).toBe('Docs');
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it('moves the destination folder under a new parent path (notes travel by id)', async () => {
    seedConfig({ id: 'a', root_name: 'Docs', target_folder_id: 'f1', handle: fakeDir('docs', []) });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'Projekty/Docs'
    });

    expect(outcome).toEqual({ ok: true });
    // Parent created, existing folder moved under it; same leaf -> no rename.
    // All deferred (skipSync) and flushed by one ordered push, so the new
    // parent lands before the moved child references it (no server 404).
    expect(createSpy).toHaveBeenCalledWith('Projekty', undefined, { skipSync: true });
    const projekty = folderRows.find((f) => f.name === 'Projekty')!;
    expect(moveSpy).toHaveBeenCalledWith('f1', projekty.id, { skipSync: true });
    expect(folderRows.find((f) => f.id === 'f1')?.parent_id).toBe(projekty.id);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(pushPendingItemsSpy).toHaveBeenCalled();
    const row = rows.find((r) => r.id === 'a')!;
    expect(row.root_name).toBe('Projekty/Docs');
    expect(row.target_folder_id).toBe('f1');
    expect(row.last_sync_at).toBeNull();
  });

  it('rejects nesting a destination under its own descendant (name-cycle)', async () => {
    seedConfig({ id: 'a', root_name: 'Docs', target_folder_id: 'f1', handle: fakeDir('docs', []) });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    folderRows.push({ id: 'f2', name: 'Sub', parent_id: 'f1' });
    const svc = await loadService();

    const outcome = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'Docs/Sub/Docs'
    });

    expect(outcome).toEqual({ ok: false, error: 'name-cycle' });
    expect(moveSpy).not.toHaveBeenCalled();
    expect(rows.find((r) => r.id === 'a')?.root_name).toBe('Docs');
  });
});

describe('rewrite-links setting', () => {
  it('addLinkedFolder defaults the flag off and stores it on when opted in', async () => {
    const svc = await loadService();
    const off = await svc.addLinkedFolder(
      fakeDir('d1', []) as unknown as FileSystemDirectoryHandle,
      'Off'
    );
    const on = await svc.addLinkedFolder(
      fakeDir('d2', []) as unknown as FileSystemDirectoryHandle,
      'On',
      true
    );
    if (!off.ok || !on.ok) throw new Error('add should succeed');
    expect(rows.find((r) => r.id === off.id)?.rewrite_links).toBe(0);
    expect(rows.find((r) => r.id === on.id)?.rewrite_links).toBe(1);
  });

  it('passes rewriteInterNoteLinks to importFolder per the config flag', async () => {
    seedConfig({ id: 'on', handle: fakeDir('on', ['a.md']), rewrite_links: 1 });
    seedConfig({ id: 'off', handle: fakeDir('off', ['b.md']) });
    const svc = await loadService();

    await svc.runFolderSync('manual', 'on');
    expect(importCalls.at(-1)?.rewriteInterNoteLinks).toBe(true);

    await svc.runFolderSync('manual', 'off');
    expect(importCalls.at(-1)?.rewriteInterNoteLinks).toBe(false);
  });

  it('toggling rewrite on resets the watermark; omitting it preserves the flag', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Docs',
      target_folder_id: 'f1',
      handle: fakeDir('docs', []),
      rewrite_links: 0,
      last_sync_at: '2026-06-10T00:00:00.000Z',
      known_paths: ['docs/a.md']
    });
    folderRows.push({ id: 'f1', name: 'Docs', parent_id: null });
    const svc = await loadService();

    // Toggle ON (same destination) → watermark + known set reset so the next
    // run re-reads every file and rewrites their links.
    const on = await svc.updateFolderSyncConfig('a', {
      sourceLabel: null,
      destName: 'Docs',
      rewriteLinks: true
    });
    expect(on).toEqual({ ok: true });
    let row = rows.find((r) => r.id === 'a')!;
    expect(row.rewrite_links).toBe(1);
    expect(row.last_sync_at).toBeNull();
    expect(row.known_paths).toBeUndefined();

    // A later edit that omits rewriteLinks preserves the flag and (no dest
    // change) does not reset a freshly-advanced watermark.
    row.last_sync_at = '2026-06-11T00:00:00.000Z';
    const keep = await svc.updateFolderSyncConfig('a', { sourceLabel: 'note', destName: 'Docs' });
    expect(keep).toEqual({ ok: true });
    row = rows.find((r) => r.id === 'a')!;
    expect(row.rewrite_links).toBe(1);
    expect(row.last_sync_at).toBe('2026-06-11T00:00:00.000Z');
  });
});

describe('syncedFolderConfigs', () => {
  it('maps target folder ids to config ids for the folder UI', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Reapps Docs',
      target_folder_id: 'f-docs',
      handle: fakeDir('docs', [])
    });
    seedConfig({
      id: 'b',
      root_name: 'Notes',
      target_folder_id: 'f-notes',
      handle: fakeDir('notes', [])
    });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    const map = get(svc.syncedFolderConfigs);
    expect(map.get('f-docs')).toBe('a');
    expect(map.get('f-notes')).toBe('b');
    expect(map.get('absent')).toBeUndefined();
  });

  it('back-fills target_folder_id by name for link-by-name records (migration)', async () => {
    // Pre-2026-06-13 record: no target_folder_id, but a matching top-level
    // folder exists. refreshFolderSyncStatus resolves and persists the id so
    // the by-id marker works before any sync runs.
    seedConfig({ id: 'a', root_name: 'Reapps Docs', handle: fakeDir('docs', []) });
    folderRows.push({ id: 'f-docs', name: 'Reapps Docs', parent_id: null });
    const svc = await loadService();
    await svc.refreshFolderSyncStatus();

    expect(rows.find((r) => r.id === 'a')?.target_folder_id).toBe('f-docs');
    expect(get(svc.syncedFolderConfigs).get('f-docs')).toBe('a');
  });
});
