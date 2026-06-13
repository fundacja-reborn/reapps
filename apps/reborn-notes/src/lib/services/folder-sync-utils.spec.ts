import { describe, it, expect } from 'vitest';
import {
  collectMarkdownEntries,
  filterEntriesToSync,
  MAX_SYNC_DEPTH,
  MTIME_FILTER_MARGIN_MS,
  type DirectoryHandleLike,
  type FileHandleLike,
  type SyncFileEntry
} from './folder-sync-utils';

// ── Fakes ────────────────────────────────────────────────────────────────
// Plain objects satisfying the structural handle types - no real File
// System Access API (Chromium-only) exists in the vitest environment.

function fakeFileHandle(name: string, lastModified = 1_000): FileHandleLike {
  return {
    kind: 'file',
    name,
    getFile: async () => new File(['# content'], name, { lastModified })
  };
}

function fakeDirHandle(
  name: string,
  children: Array<FileHandleLike | DirectoryHandleLike>
): DirectoryHandleLike {
  return {
    kind: 'directory',
    name,
    values: async function* () {
      yield* children;
    }
  };
}

function syncEntry(name: string, lastModified: number): SyncFileEntry {
  return {
    file: new File(['x'], name, { lastModified }),
    relativePath: `Vault/${name}`
  };
}

describe('collectMarkdownEntries', () => {
  it('collects .md files with webkitRelativePath-shaped paths rooted at the dir name', async () => {
    const root = fakeDirHandle('Vault', [
      fakeFileHandle('a.md'),
      fakeDirHandle('Projects', [
        fakeFileHandle('b.md'),
        fakeDirHandle('Web', [fakeFileHandle('c.MD')])
      ])
    ]);

    const { entries, skippedTooDeep } = await collectMarkdownEntries(root);

    expect(entries.map((e) => e.relativePath).sort()).toEqual([
      'Vault/Projects/Web/c.MD',
      'Vault/Projects/b.md',
      'Vault/a.md'
    ]);
    expect(skippedTooDeep).toBe(0);
  });

  it('skips non-markdown files', async () => {
    const root = fakeDirHandle('Vault', [
      fakeFileHandle('note.md'),
      fakeFileHandle('image.png'),
      fakeFileHandle('config.json')
    ]);

    const { entries } = await collectMarkdownEntries(root);

    expect(entries.map((e) => e.relativePath)).toEqual(['Vault/note.md']);
  });

  it('does not descend into hidden directories and skips hidden files', async () => {
    const root = fakeDirHandle('Vault', [
      fakeFileHandle('visible.md'),
      fakeFileHandle('.hidden.md'),
      fakeDirHandle('.obsidian', [fakeFileHandle('plugin.md')]),
      fakeDirHandle('.trash', [fakeFileHandle('deleted.md')])
    ]);

    const { entries } = await collectMarkdownEntries(root);

    expect(entries.map((e) => e.relativePath)).toEqual(['Vault/visible.md']);
  });

  it('allows a hidden ROOT directory (the user picked it deliberately)', async () => {
    const root = fakeDirHandle('.dotvault', [fakeFileHandle('note.md')]);

    const { entries } = await collectMarkdownEntries(root);

    expect(entries.map((e) => e.relativePath)).toEqual(['.dotvault/note.md']);
  });

  it('stops descending past MAX_SYNC_DEPTH and reports the skipped subtree', async () => {
    // Build a chain root -> d1 -> d2 -> ... deeper than the cap, with one
    // .md at every level.
    let leaf: DirectoryHandleLike = fakeDirHandle('deepest', [fakeFileHandle('leaf.md')]);
    for (let i = MAX_SYNC_DEPTH + 1; i >= 1; i--) {
      leaf = fakeDirHandle(`d${i}`, [fakeFileHandle(`n${i}.md`), leaf]);
    }
    const root = fakeDirHandle('Vault', [leaf]);

    const { entries, skippedTooDeep } = await collectMarkdownEntries(root);

    // Levels within the cap are collected; the over-deep subtree is counted.
    expect(skippedTooDeep).toBe(1);
    expect(entries.some((e) => e.relativePath.endsWith('/leaf.md'))).toBe(false);
    expect(entries.some((e) => e.relativePath.endsWith('/n1.md'))).toBe(true);
  });

  it('returns no entries for an empty directory', async () => {
    const { entries, skippedTooDeep } = await collectMarkdownEntries(fakeDirHandle('Empty', []));
    expect(entries).toEqual([]);
    expect(skippedTooDeep).toBe(0);
  });

  it('roots paths at a custom rootName instead of the directory name', async () => {
    // Two sync configs may point at directories that share an on-disk name
    // ("notes"); the per-config display name keeps their paths - and thus
    // their top-level target folders - apart.
    const root = fakeDirHandle('notes', [
      fakeFileHandle('a.md'),
      fakeDirHandle('Sub', [fakeFileHandle('b.md')])
    ]);

    const { entries } = await collectMarkdownEntries(root, 'Notes (work)');

    expect(entries.map((e) => e.relativePath).sort()).toEqual([
      'Notes (work)/Sub/b.md',
      'Notes (work)/a.md'
    ]);
  });

  it('defaults the path root to the directory name when rootName is omitted', async () => {
    const root = fakeDirHandle('Vault', [fakeFileHandle('a.md')]);
    const { entries } = await collectMarkdownEntries(root);
    expect(entries[0].relativePath).toBe('Vault/a.md');
  });
});

describe('filterEntriesToSync', () => {
  const T0 = Date.parse('2026-06-12T12:00:00.000Z');

  /** All paths of `entries` marked as already known to the sync config. */
  function knownAll(entries: SyncFileEntry[]): Set<string> {
    return new Set(entries.map((e) => e.relativePath));
  }

  it('passes everything through on first sync (lastSyncAt = null)', () => {
    const entries = [syncEntry('a.md', T0 - 100_000), syncEntry('b.md', T0)];
    expect(filterEntriesToSync(entries, null, new Set())).toHaveLength(2);
  });

  it('passes everything through for legacy configs without a known-path set', () => {
    const entries = [syncEntry('a.md', T0 - 100_000)];
    expect(filterEntriesToSync(entries, new Date(T0).toISOString(), null)).toHaveLength(1);
  });

  it('keeps only known files modified after lastSyncAt minus the safety margin', () => {
    const lastSyncAt = new Date(T0).toISOString();
    const oldFile = syncEntry('old.md', T0 - MTIME_FILTER_MARGIN_MS - 1);
    const marginFile = syncEntry('margin.md', T0 - MTIME_FILTER_MARGIN_MS + 1);
    const newFile = syncEntry('new.md', T0 + 5_000);
    const all = [oldFile, marginFile, newFile];

    const kept = filterEntriesToSync(all, lastSyncAt, knownAll(all));

    expect(kept.map((e) => e.file.name)).toEqual(['margin.md', 'new.md']);
  });

  it('always keeps paths NOT in the known set, even with an old mtime (copied/moved-in files)', () => {
    const lastSyncAt = new Date(T0).toISOString();
    const known = syncEntry('known-old.md', T0 - 100_000);
    // Copied into the directory after the last scan, but Finder/cp/mv kept
    // its original (old) modification date - the watermark alone misses it.
    const copiedIn = syncEntry('copied-in.md', T0 - 100_000);

    const kept = filterEntriesToSync([known, copiedIn], lastSyncAt, knownAll([known]));

    expect(kept.map((e) => e.file.name)).toEqual(['copied-in.md']);
  });

  it('treats a deleted-then-restored path as new again (set is a per-scan snapshot)', () => {
    const lastSyncAt = new Date(T0).toISOString();
    const restored = syncEntry('restored.md', T0 - 100_000);
    // The previous scan no longer saw the file, so its path is absent.
    const kept = filterEntriesToSync([restored], lastSyncAt, new Set(['Vault/other.md']));
    expect(kept).toHaveLength(1);
  });

  it('always keeps known files without mtime info (lastModified === 0)', () => {
    const lastSyncAt = new Date(T0).toISOString();
    const noMtime = syncEntry('no-mtime.md', 0);

    const kept = filterEntriesToSync([noMtime], lastSyncAt, knownAll([noMtime]));

    expect(kept).toHaveLength(1);
  });

  it('falls back to a full pass when lastSyncAt is unparsable', () => {
    const entries = [syncEntry('a.md', 123)];
    expect(filterEntriesToSync(entries, 'not-a-date', knownAll(entries))).toHaveLength(1);
  });
});
