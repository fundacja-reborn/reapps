import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteIndexEntry } from './note-index.svelte';

// The real NoteIndex against hand-written entries: this spec locks which
// bucket (active / archive / trash) each kind of note lands in, and that no
// everyday read path leaks archived notes.

// This config has no Svelte plugin, so the `$state` rune in the index class is
// not compiled away. The index only uses it as a change counter for reactive
// readers; a pass-through is enough to exercise the filtering logic here.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).$state = <T>(value: T): T => value;
});

vi.mock('@reborn/storage', () => ({
  noteStore: { getAllMeta: async () => [], getManyMeta: async () => [] },
  noteTagStore: { getAll: async () => [] },
  noteTagQueries: { getTagsForNote: async () => [] }
}));
vi.mock('@reborn/crypto', () => ({ cryptoManager: { isInitialized: () => true } }));
vi.mock('./note.service', () => ({ decryptTitleOnly: vi.fn() }));
vi.mock('./note-link-graph.svelte', () => ({ noteLinkGraph: { clear: vi.fn() } }));
vi.mock('./note-nav-history.svelte', () => ({ noteNavHistory: { clear: vi.fn() } }));

const { noteIndex } = await import('./note-index.svelte');
const { parseQuery } = await import('@reborn/utils');

const OLD = '2026-11-01T00:00:00.000Z';
const NEW = '2026-11-10T00:00:00.000Z';

function entry(extra: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    title: 'note',
    folderId: undefined,
    isPinned: false,
    isStarred: false,
    isTrashed: false,
    createdAt: OLD,
    updatedAt: OLD,
    tagIds: [],
    ...extra
  };
}

const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();

beforeEach(() => {
  noteIndex.clear();
  noteIndex.update('active', entry({ title: 'alpha active', folderId: 'work' }));
  noteIndex.update('own', entry({ title: 'alpha own', folderId: 'work', archivedAt: OLD }));
  noteIndex.update('via-folder', entry({ title: 'alpha via folder', folderId: 'old-sub' }));
  noteIndex.update(
    'both',
    entry({ title: 'alpha both', folderId: 'old', archivedAt: NEW, isPinned: true })
  );
  noteIndex.update('trashed', entry({ title: 'alpha trashed', isTrashed: true }));
  noteIndex.update(
    'trashed-archived',
    entry({ title: 'alpha trashed archived', isTrashed: true, archivedAt: OLD })
  );
  noteIndex.setArchivedFolders(
    new Map([
      ['old', { rootId: 'old', at: '2026-11-05T00:00:00.000Z' }],
      ['old-sub', { rootId: 'old', at: '2026-11-05T00:00:00.000Z' }]
    ])
  );
});

describe('note index buckets', () => {
  it('active: no archived and no trashed notes', () => {
    expect(ids(noteIndex.getFiltered().items)).toEqual(['active']);
    expect(ids(noteIndex.getFiltered({ scope: 'active' }).items)).toEqual(['active']);
  });

  it('archive: own marker, archived folder, or both - never trashed notes', () => {
    expect(ids(noteIndex.getFiltered({ scope: 'archive' }).items)).toEqual([
      'both',
      'own',
      'via-folder'
    ]);
  });

  it('trash: every trashed note, whatever its archive state', () => {
    expect(ids(noteIndex.getFiltered({ scope: 'trash' }).items)).toEqual([
      'trashed',
      'trashed-archived'
    ]);
  });

  it('a folder view never shows a note archived on its own inside an active folder', () => {
    expect(ids(noteIndex.getFiltered({ folderId: 'work' }).items)).toEqual(['active']);
  });

  it('title search and operator search stay inside the bucket', () => {
    expect(ids(noteIndex.getFiltered({ search: 'alpha' }).items)).toEqual(['active']);
    expect(ids(noteIndex.getFiltered({ search: 'alpha', scope: 'archive' }).items)).toEqual([
      'both',
      'own',
      'via-folder'
    ]);
    const ctx = { tagIdByName: new Map(), folderIdByPath: new Map(), now: new Date() };
    const ast = parseQuery('alpha -trashed');
    expect(ids(noteIndex.getFilteredByAst(ast, ctx as never).items)).toEqual(['active']);
    expect(ids(noteIndex.getFilteredByAst(ast, ctx as never, { scope: 'archive' }).items)).toEqual(
      ['both', 'own', 'via-folder']
    );
  });

  it('can narrow the archive to one archived folder subtree', () => {
    const { items } = noteIndex.getFiltered({ scope: 'archive', folderIds: ['old', 'old-sub'] });
    expect(ids(items)).toEqual(['both', 'via-folder']);
  });
});

describe('note index - what archived notes are hidden from', () => {
  it('[[link]] suggestions and the note picker (getAll) offer active notes only', () => {
    expect(noteIndex.getAll().map((n) => n.id)).toEqual(['active']);
    expect(noteIndex.search('alpha').map((n) => n.id)).toEqual(['active']);
  });

  it('dedup / lookup callers (entries) still see archived notes, not trashed ones', () => {
    // Periodic notes and the importer must find an archived note, or they
    // would create a duplicate next to it.
    expect(ids(noteIndex.entries())).toEqual(['active', 'both', 'own', 'via-folder']);
  });

  it('an archived note still resolves by id (an existing link to it opens it)', () => {
    expect(noteIndex.getItem('own')?.title).toBe('alpha own');
    expect(noteIndex.isInArchive('own')).toBe(true);
    expect(noteIndex.isInArchive('via-folder')).toBe(true);
    expect(noteIndex.isInArchive('active')).toBe(false);
    expect(noteIndex.isInArchive('missing')).toBe(false);
  });
});

describe('note index - archive details on list items', () => {
  it('tells an own marker from an archived folder', () => {
    expect(noteIndex.getItem('active')?.archive).toBeUndefined();
    expect(noteIndex.getItem('own')?.archive).toEqual({ at: OLD });
    // Through a subfolder of the archived folder: points at the topmost one.
    expect(noteIndex.getItem('via-folder')?.archive).toEqual({
      at: '2026-11-05T00:00:00.000Z',
      folderId: 'old'
    });
    // Both: the folder still holds it, and its own (later) date is shown.
    expect(noteIndex.getItem('both')?.archive).toEqual({ at: NEW, folderId: 'old' });
    expect(noteIndex.getItem('both')?.archived_at).toBe(NEW);
    expect(noteIndex.getItem('via-folder')?.archived_at).toBeUndefined();
  });

  it('orders the archive by archive date, newest first, ignoring pins', () => {
    const order = noteIndex.getFiltered({ scope: 'archive', sortBy: 'title' }).items.map((i) => i.id);
    expect(order).toEqual(['both', 'via-folder', 'own']);
  });
});

describe('note index - folder scope changes', () => {
  it('restoring the folder returns its notes to the active bucket, except own markers', () => {
    expect(noteIndex.setArchivedFolders(new Map())).toBe(true);

    expect(ids(noteIndex.getFiltered().items)).toEqual(['active', 'via-folder']);
    expect(ids(noteIndex.getFiltered({ scope: 'archive' }).items)).toEqual(['both', 'own']);
    expect(noteIndex.getItem('both')?.archive).toEqual({ at: NEW });
  });

  it('reports no change for an identical scope, so lists are not refreshed for nothing', () => {
    const same = new Map([
      ['old', { rootId: 'old', at: '2026-11-05T00:00:00.000Z' }],
      ['old-sub', { rootId: 'old', at: '2026-11-05T00:00:00.000Z' }]
    ]);
    expect(noteIndex.setArchivedFolders(same)).toBe(false);
  });

  it('a note moved out of the archived folder becomes active', () => {
    noteIndex.patch('via-folder', { folderId: 'work' });
    expect(noteIndex.isInArchive('via-folder')).toBe(false);
  });

  it('clear() forgets the scope (lock / logout)', () => {
    noteIndex.clear();
    noteIndex.update('n', entry({ folderId: 'old' }));
    expect(noteIndex.isInArchive('n')).toBe(false);
  });

  it('counts the notes an archived folder holds, without trashed ones', () => {
    noteIndex.update('gone', entry({ folderId: 'old', isTrashed: true }));
    expect(noteIndex.countInFolders(['old', 'old-sub'])).toBe(2);
  });
});
