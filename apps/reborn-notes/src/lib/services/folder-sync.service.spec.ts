import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { FolderSyncConfigRecord } from '@reborn/storage';

// ── Module mocks ─────────────────────────────────────────────────────────
// The service is exercised against an in-memory config store and a stubbed
// importFolder; directory handles are plain fakes satisfying the structural
// slice the service touches (no real File System Access API in vitest).

const rows: FolderSyncConfigRecord[] = [];

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
  }
}));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ isAuthenticated: true, hasE2E: true }) };
});

const refreshSpy = vi.fn();
vi.mock('$lib/stores/notes.store', () => ({ notesStore: { refresh: refreshSpy } }));
vi.mock('$lib/stores/folders.store', () => ({ foldersStore: { refresh: refreshSpy } }));
vi.mock('$lib/stores/tags.store', () => ({ tagsStore: { refresh: refreshSpy } }));

// Concurrency tracker: the runner must never overlap two imports.
let activeImports = 0;
let maxActiveImports = 0;
type ImportCall = { paths: string[] };
const importCalls: ImportCall[] = [];

vi.mock('./export-import.service', () => ({
  importFolder: vi.fn(
    async (entries: Array<{ file: File; relativePath: string }>) => {
      activeImports++;
      maxActiveImports = Math.max(maxActiveImports, activeImports);
      importCalls.push({ paths: entries.map((e) => e.relativePath) });
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
        errors: []
      };
    }
  )
}));

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
  importCalls.length = 0;
  activeImports = 0;
  maxActiveImports = 0;
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

  it('roots import paths at the config display name, not the on-disk name', async () => {
    seedConfig({
      id: 'a',
      root_name: 'Notes (work)',
      handle: fakeDir('notes', ['a.md'])
    });
    const svc = await loadService();

    await svc.runFolderSync('manual');

    expect(importCalls[0].paths).toEqual(['Notes (work)/a.md']);
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

    expect(importCalls.map((c) => c.paths[0])).toEqual(['A/a.md', 'C/c.md']);
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

    expect(importCalls.map((c) => c.paths[0])).toEqual(['B/b.md']);
    expect(get(svc.folderSyncStatus).find((s) => s.id === 'a')?.state).toBe('needs-permission');
  });

  it('auto runs cover only configs with auto-sync enabled', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']), auto_sync: 0 });
    seedConfig({ id: 'b', root_name: 'B', handle: fakeDir('b', ['b.md']) });
    const svc = await loadService();

    await svc.runFolderSync('auto');

    expect(importCalls.map((c) => c.paths[0])).toEqual(['B/b.md']);
  });

  it('manual run with a config id targets only that config', async () => {
    seedConfig({ id: 'a', root_name: 'A', handle: fakeDir('a', ['a.md']) });
    seedConfig({ id: 'b', root_name: 'B', handle: fakeDir('b', ['b.md']) });
    const svc = await loadService();

    const result = await svc.runFolderSync('manual', 'b');

    expect(importCalls.map((c) => c.paths[0])).toEqual(['B/b.md']);
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
  });
});
