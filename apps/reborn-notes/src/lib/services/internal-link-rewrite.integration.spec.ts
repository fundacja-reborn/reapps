import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Integration test: importFolder + inter-note link rewriting ─────────────
// Exercises the REAL importFolder (two-phase resolve → rewrite → write) against
// an in-memory note graph. The heavy service layer is faked the same way
// folder-sync.service.spec fakes its deps (no IndexedDB / crypto in vitest).

/** In-memory note store the mocked NoteService writes to. */
const notes = new Map<string, { id: string; title: string; content: string; folderId?: string }>();
let idCounter = 0;

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ isAuthenticated: true, hasE2E: true }) };
});

vi.mock('@reborn/storage', () => ({
  noteStore: {
    // Import dedup probes existence via count(); liveNoteIds() reads the
    // metadata projection (DB v14 split) - ids only.
    count: async () => notes.size,
    getAllMeta: async () => [...notes.values()].map((n) => ({ id: n.id }))
  },
  folderStore: {},
  tagStore: {},
  noteTagStore: {},
  noteTagOperations: {},
  noteTagQueries: { getTagsForNote: async () => [] }
}));

vi.mock('./note.service', () => ({
  createNote: async (
    title: string,
    content: string,
    folderId: string | undefined,
    opts?: { id?: string }
  ) => {
    const id = opts?.id ?? `gen-${++idCounter}`;
    notes.set(id, { id, title, content, folderId });
    return id;
  },
  getNote: async (id: string) => {
    const n = notes.get(id);
    return n ? { id: n.id, title: n.title, content: n.content, folder_id: n.folderId } : null;
  },
  updateNote: async (id: string, title: string, content: string) => {
    const n = notes.get(id);
    if (n) {
      n.title = title;
      n.content = content;
    }
  }
}));

vi.mock('./folder.service', () => ({
  getFolderTree: async () => [],
  createFolder: async () => `folder-${++idCounter}`
}));

vi.mock('./tag.service', () => ({
  getAllTags: async () => [],
  createTag: async () => `tag-${++idCounter}`,
  setTagsForNote: async () => {}
}));

vi.mock('./notes-sync.service', () => ({
  pushNote: () => {},
  pushPendingItems: () => {}
}));

vi.mock('./note-index.svelte', () => ({
  noteIndex: {
    count: 0,
    entries: () => [],
    build: async () => {},
    rebuild: async () => {},
    update: () => {}
  }
}));

import { importFolder, type ImportFolderInput } from './export-import.service';

/** Minimal File stand-in: importFolder only reads name/size/lastModified/text(). */
function mdFile(name: string, body: string): File {
  return {
    name,
    size: body.length,
    lastModified: 0,
    text: async () => body
  } as unknown as File;
}

function input(name: string, relativePath: string, body: string): ImportFolderInput {
  return { file: mdFile(name, body), relativePath };
}

beforeEach(() => {
  notes.clear();
  idCounter = 0;
});

describe('importFolder inter-note link rewriting', () => {
  const files = (): ImportFolderInput[] => [
    input('a.md', 'vault/a.md', '---\ntitle: A\n---\nSee [B](b.md).'),
    input('b.md', 'vault/b.md', '---\ntitle: B\n---\nHi.')
  ];

  it('leaves relative links untouched when the flag is off (default)', async () => {
    const res = await importFolder(files(), 'rename');
    expect(res.imported).toBe(2);
    expect(res.linksRewritten).toBe(0);
    const a = [...notes.values()].find((n) => n.title === 'A');
    expect(a?.content).toBe('See [B](b.md).');
  });

  it('rewrites a relative link to the linked note id when the flag is on', async () => {
    const res = await importFolder(files(), 'rename', undefined, { rewriteInterNoteLinks: true });
    expect(res.imported).toBe(2);
    expect(res.linksRewritten).toBe(1);
    const idA = res.pathToNoteId['vault/a.md'];
    const idB = res.pathToNoteId['vault/b.md'];
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    // a.md was processed before b.md existed as a note, yet its link resolves to
    // b's id - proving the up-front resolve pass (the whole point of two-phase).
    expect(notes.get(idA)?.content).toBe(`See [B](note:${idB}).`);
    expect(notes.get(idB)?.content).toBe('Hi.');
  });

  it('re-imports identical content as a no-op (idempotent with rewrite on)', async () => {
    const r1 = await importFolder(files(), 'overwrite', undefined, { rewriteInterNoteLinks: true });
    expect(r1.imported).toBe(2);

    // Second run mirrors live folder sync: same files, overwrite strategy, the
    // previous run's path→note manifest. The rewrite is applied to the incoming
    // disk content BEFORE the unchanged-comparison, so it matches the stored
    // (already-rewritten) note exactly - no write, no churn.
    const r2 = await importFolder(files(), 'overwrite', undefined, {
      rewriteInterNoteLinks: true,
      pathManifest: r1.pathToNoteId
    });
    expect(r2.imported).toBe(0);
    expect(r2.duplicatesUnchanged).toBe(2);
    expect(r2.linksRewritten).toBe(0);
  });

  it('resolves a link to a file left unchanged this run via the manifest', async () => {
    // First import both files so b exists and the manifest is populated.
    const r1 = await importFolder(files(), 'overwrite', undefined, { rewriteInterNoteLinks: true });
    const idB = r1.pathToNoteId['vault/b.md'];

    // Now re-import ONLY a.md (folder sync's incremental changed-set), with a's
    // link still pointing at b.md. b is not in this batch, but the manifest
    // carries its id, so the link still resolves.
    const r2 = await importFolder(
      [input('a.md', 'vault/a.md', '---\ntitle: A\n---\nGo [B](b.md) now.')],
      'overwrite',
      undefined,
      { rewriteInterNoteLinks: true, pathManifest: r1.pathToNoteId }
    );
    expect(r2.linksRewritten).toBe(1);
    const idA = r2.pathToNoteId['vault/a.md'];
    expect(notes.get(idA)?.content).toBe(`Go [B](note:${idB}) now.`);
  });

  it('preserves a #heading fragment as a note anchor (encoded path link)', async () => {
    const res = await importFolder(
      [
        input('a.md', 'vault/a.md', '---\ntitle: A\n---\nJump [B](b.md#Some%20Section).'),
        input('b.md', 'vault/b.md', '---\ntitle: B\n---\n## Some Section')
      ],
      'rename',
      undefined,
      { rewriteInterNoteLinks: true }
    );
    const idA = res.pathToNoteId['vault/a.md'];
    const idB = res.pathToNoteId['vault/b.md'];
    expect(notes.get(idA)?.content).toBe(`Jump [B](note:${idB}#some-section).`);
  });
});

describe('importFolder Obsidian wikilink rewriting', () => {
  it('leaves wikilinks untouched when the flag is off (default)', async () => {
    const files: ImportFolderInput[] = [
      input('a.md', 'vault/a.md', '---\ntitle: A\n---\nSee [[B]].'),
      input('b.md', 'vault/b.md', '---\ntitle: B\n---\nHi.')
    ];
    const res = await importFolder(files, 'rename');
    expect(res.linksRewritten).toBe(0);
    const idA = res.pathToNoteId['vault/a.md'];
    expect(notes.get(idA)?.content).toBe('See [[B]].');
  });

  it('rewrites [[wikilinks]] (with alias) to note: links when the flag is on', async () => {
    const files: ImportFolderInput[] = [
      input('a.md', 'vault/a.md', '---\ntitle: A\n---\nSee [[B]] and [[B|the bee]].'),
      input('b.md', 'vault/b.md', '---\ntitle: B\n---\nHi.')
    ];
    const res = await importFolder(files, 'rename', undefined, { rewriteInterNoteLinks: true });
    expect(res.imported).toBe(2);
    expect(res.linksRewritten).toBe(2);
    const idA = res.pathToNoteId['vault/a.md'];
    const idB = res.pathToNoteId['vault/b.md'];
    expect(notes.get(idA)?.content).toBe(`See [B](note:${idB}) and [the bee](note:${idB}).`);
  });

  it('resolves a wikilink by FILE basename, not by frontmatter title', async () => {
    const files: ImportFolderInput[] = [
      input('a.md', 'vault/a.md', '---\ntitle: Alpha\n---\nGo to [[target]].'),
      // File basename is "target", but the note title is "Renamed". Obsidian
      // wikilinks address the file, so resolution must use the basename.
      input('target.md', 'vault/target.md', '---\ntitle: Renamed\n---\nHere.')
    ];
    const res = await importFolder(files, 'rename', undefined, { rewriteInterNoteLinks: true });
    const idA = res.pathToNoteId['vault/a.md'];
    const idTarget = res.pathToNoteId['vault/target.md'];
    expect(notes.get(idTarget)?.title).toBe('Renamed');
    expect(notes.get(idA)?.content).toBe(`Go to [target](note:${idTarget}).`);
    expect(res.linksRewritten).toBe(1);
  });

  it('leaves an ambiguous bare [[wikilink]] untouched but resolves the path form', async () => {
    const files: ImportFolderInput[] = [
      input('a.md', 'vault/a.md', '---\ntitle: A\n---\nBare [[Dup]] vs path [[x/Dup]].'),
      input('Dup.md', 'vault/x/Dup.md', 'one'),
      input('Dup.md', 'vault/y/Dup.md', 'two')
    ];
    const res = await importFolder(files, 'rename', undefined, { rewriteInterNoteLinks: true });
    const idA = res.pathToNoteId['vault/a.md'];
    const idDupX = res.pathToNoteId['vault/x/Dup.md'];
    // Bare [[Dup]] is ambiguous → untouched; [[x/Dup]] names one file → resolved.
    expect(notes.get(idA)?.content).toBe(`Bare [[Dup]] vs path [x/Dup](note:${idDupX}).`);
    expect(res.linksRewritten).toBe(1);
  });

  it('rewrites a [[Doc#Heading]] wikilink to a note anchor', async () => {
    const files: ImportFolderInput[] = [
      input('a.md', 'vault/a.md', '---\ntitle: A\n---\nSee [[B#Some Heading]].'),
      input('b.md', 'vault/b.md', '---\ntitle: B\n---\n## Some Heading')
    ];
    const res = await importFolder(files, 'rename', undefined, { rewriteInterNoteLinks: true });
    const idA = res.pathToNoteId['vault/a.md'];
    const idB = res.pathToNoteId['vault/b.md'];
    expect(notes.get(idA)?.content).toBe(`See [B](note:${idB}#some-heading).`);
    expect(res.linksRewritten).toBe(1);
  });
});
