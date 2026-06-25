import { describe, it, expect } from 'vitest';
import type {
  NoteStoredLocal,
  NoteSensitiveMetadata,
  FolderEncrypted,
  TagEncrypted
} from '@reborn/types';
import {
  buildPortablePayload,
  reencryptPortablePayload,
  noteToPortable,
  decryptFieldOr,
  type PortableCrypto
} from './portable-backup-utils';

/**
 * Fake account-scoped crypto. Ciphertext is tagged with the account id, so a
 * different account's crypto throws on decrypt - exactly like AES-GCM with the
 * wrong master key. This is what lets us prove cross-account portability: data
 * exported under account A must re-encrypt and read back under account B, and
 * A's ciphertext must NOT be readable by B (and vice versa).
 */
function makeFakeCrypto(accountId: string): PortableCrypto {
  const wrap = (kind: string, plain: string) => `${accountId}::${kind}::${encodeURIComponent(plain)}`;
  const unwrap = (kind: string, ct: string) => {
    const prefix = `${accountId}::${kind}::`;
    if (typeof ct !== 'string' || !ct.startsWith(prefix)) {
      throw new Error(`decrypt failed: ciphertext not for ${accountId}/${kind}`);
    }
    return decodeURIComponent(ct.slice(prefix.length));
  };
  return {
    encryptText: async (t) => wrap('txt', t),
    decryptText: async (ct) => unwrap('txt', ct),
    encryptObject: async (o) => wrap('obj', JSON.stringify(o)),
    decryptObject: async (ct) => JSON.parse(unwrap('obj', ct))
  };
}

const A = makeFakeCrypto('accountA');
const B = makeFakeCrypto('accountB');

async function makeStoredNote(
  crypto: PortableCrypto,
  plain: {
    id: string;
    title: string;
    content: string;
    folder_id?: string;
    is_archived?: boolean;
    meta?: NoteSensitiveMetadata;
    created_at?: string;
    updated_at?: string;
  }
): Promise<NoteStoredLocal> {
  return {
    id: plain.id,
    user_id: 'user-A',
    folder_id: plain.folder_id,
    title_encrypted: await crypto.encryptText(plain.title),
    content_encrypted: await crypto.encryptText(plain.content),
    metadata_encrypted: plain.meta ? await crypto.encryptObject(plain.meta) : undefined,
    is_archived: plain.is_archived ?? false,
    is_pinned: plain.meta?.is_pinned ?? false,
    is_starred: plain.meta?.is_starred ?? false,
    created_at: plain.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: plain.updated_at ?? '2026-01-02T00:00:00.000Z',
    sync_status: 'synced',
    sync_version: 1
  } as NoteStoredLocal;
}

async function makeStoredFolder(
  crypto: PortableCrypto,
  plain: { id: string; name: string; parent_id?: string; order_index?: number; is_archived?: boolean }
): Promise<FolderEncrypted> {
  return {
    id: plain.id,
    user_id: 'user-A',
    parent_id: plain.parent_id,
    name_encrypted: await crypto.encryptText(plain.name),
    order_index: plain.order_index ?? 0,
    is_archived: plain.is_archived ?? false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    sync_status: 'synced',
    sync_version: 1
  } as FolderEncrypted;
}

async function makeStoredTag(
  crypto: PortableCrypto,
  plain: { id: string; name: string; color?: string }
): Promise<TagEncrypted> {
  return {
    id: plain.id,
    user_id: 'user-A',
    name_encrypted: await crypto.encryptText(plain.name),
    color_encrypted: plain.color ? await crypto.encryptText(plain.color) : undefined,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    sync_status: 'synced',
    sync_version: 1
  } as TagEncrypted;
}

// Convenience: read wire fields that the typed Record hides behind `unknown`.
const field = (rec: Record<string, unknown>, key: string): string => String(rec[key]);

/**
 * Deterministic, collision-free ID generator injected into
 * `reencryptPortablePayload` so assertions don't depend on `globalThis.crypto`
 * and the new IDs are predictable. Folders are minted first, then tags, then
 * notes (the order the function assigns them).
 */
function seqIds(prefix = 'id'): () => string {
  let i = 0;
  return () => `${prefix}-${++i}`;
}

describe('buildPortablePayload (export, decrypt with account key)', () => {
  it('produces account-agnostic plaintext (no source-account ciphertext, no user_id)', async () => {
    const notes = [
      await makeStoredNote(A, {
        id: 'n1',
        title: 'My note',
        content: '# Hello\nworld',
        folder_id: 'f1',
        meta: { is_pinned: true, is_starred: false, tags: ['t1', 't2'] }
      })
    ];
    const folders = [await makeStoredFolder(A, { id: 'f1', name: 'Work', order_index: 3 })];
    const tags = [await makeStoredTag(A, { id: 't1', name: 'urgent', color: '#FF0000' })];

    const payload = await buildPortablePayload(A, notes, folders, tags, '2026-06-25T00:00:00.000Z');

    expect(payload.app).toBe('reborn-notes');
    expect(payload.format).toBe('plaintext');

    const n = payload.data.notes[0];
    expect(n.title).toBe('My note');
    expect(n.content).toBe('# Hello\nworld');
    expect(n.is_pinned).toBe(true);
    expect(n.is_starred).toBe(false);
    expect(n.tags).toEqual(['t1', 't2']);
    expect(n.folder_id).toBe('f1');
    // Account-agnostic: ciphertext and ownership must not leak into the payload.
    expect(JSON.stringify(payload)).not.toContain('accountA::');
    expect(JSON.stringify(payload)).not.toContain('user_id');

    expect(payload.data.folders[0].name).toBe('Work');
    expect(payload.data.folders[0].order_index).toBe(3);
    expect(payload.data.tags[0].name).toBe('urgent');
    expect(payload.data.tags[0].color).toBe('#FF0000');
  });

  it('preserves periodic metadata and reads pin/star/tags from metadata, not shadow indexes', async () => {
    // Shadow indexes deliberately disagree with metadata; metadata must win.
    const note = await makeStoredNote(A, {
      id: 'n2',
      title: 'Daily',
      content: 'body',
      meta: {
        is_pinned: true,
        is_starred: true,
        tags: ['daily'],
        periodic: { kind: 'daily', anchor: '2026-06-25' }
      }
    });
    note.is_pinned = false; // stale shadow index - must be ignored
    note.is_starred = false;

    const portable = await noteToPortable(A, note);
    expect(portable.is_pinned).toBe(true);
    expect(portable.is_starred).toBe(true);
    expect(portable.periodic).toEqual({ kind: 'daily', anchor: '2026-06-25' });
  });
});

describe('reencryptPortablePayload (import, re-encrypt with target account key)', () => {
  it('round-trips A -> portable -> B: readable by B, NOT by A, ownership transferred', async () => {
    const notes = [
      await makeStoredNote(A, {
        id: 'n1',
        title: 'Secret title',
        content: 'Secret body',
        folder_id: 'f1',
        meta: { is_pinned: true, is_starred: true, tags: ['t1'] },
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z'
      })
    ];
    const folders = [await makeStoredFolder(A, { id: 'f1', name: 'Folder name' })];
    const tags = [await makeStoredTag(A, { id: 't1', name: 'tagname', color: '#00FF00' })];

    const payload = await buildPortablePayload(A, notes, folders, tags, '2026-06-25T00:00:00.000Z');
    const wire = await reencryptPortablePayload(B, payload, 'user-B', seqIds());

    const n = wire.notes[0];
    // Target account (B) can read every re-encrypted field...
    expect(await B.decryptText(field(n, 'title_encrypted'))).toBe('Secret title');
    expect(await B.decryptText(field(n, 'content_encrypted'))).toBe('Secret body');
    const newTagId = String(wire.tags[0].id);
    const meta = await B.decryptObject<NoteSensitiveMetadata>(field(n, 'metadata_encrypted'));
    // Tag reference is remapped to the tag's NEW id, not the source 't1'.
    expect(meta).toEqual({ is_pinned: true, is_starred: true, tags: [newTagId] });

    // ...the source account (A) cannot (the bug being fixed: A-key ciphertext
    // used to survive untouched and was unreadable on B).
    await expect(A.decryptText(field(n, 'title_encrypted'))).rejects.toThrow();

    // Ownership transferred, structural fields preserved, sync reset to pending.
    // IDs are regenerated - reusing the source account's IDs makes the server
    // 403 the push ("Rejected by server") - and the note's folder_id is remapped
    // to the folder's NEW id.
    expect(n.id).not.toBe('n1');
    expect(n.user_id).toBe('user-B');
    expect(n.folder_id).toBe(String(wire.folders[0].id));
    expect(n.folder_id).not.toBe('f1');
    expect(n.is_archived).toBe(false);
    expect(n.created_at).toBe('2026-03-01T00:00:00.000Z');
    expect(n.updated_at).toBe('2026-03-02T00:00:00.000Z');
    expect(n.sync_status).toBe('pending');
    expect(n.sync_version).toBe(0);

    const f = wire.folders[0];
    expect(f.id).not.toBe('f1');
    expect(await B.decryptText(field(f, 'name_encrypted'))).toBe('Folder name');
    expect(f.user_id).toBe('user-B');

    const t = wire.tags[0];
    expect(t.id).not.toBe('t1');
    expect(await B.decryptText(field(t, 'name_encrypted'))).toBe('tagname');
    expect(await B.decryptText(field(t, 'color_encrypted'))).toBe('#00FF00');
    expect(t.user_id).toBe('user-B');
  });

  it('regenerates all IDs and remaps foreign keys (parent_id, folder_id, tags); drops dangling refs', async () => {
    // Parent + child folder, a note in the child folder tagged with one known
    // tag and one tag that is NOT in the backup (dangling - must be dropped).
    const folders = [
      await makeStoredFolder(A, { id: 'parent', name: 'Parent' }),
      await makeStoredFolder(A, { id: 'child', name: 'Child', parent_id: 'parent' })
    ];
    const tags = [await makeStoredTag(A, { id: 'tagA', name: 'keep' })];
    const noteWithDangling = await makeStoredNote(A, {
      id: 'note1',
      title: 'In child',
      content: 'x',
      folder_id: 'child',
      meta: { is_pinned: false, is_starred: false, tags: ['tagA', 'ghost'] }
    });
    // A second note pointing at a folder that is not part of the backup; its
    // folder_id must be dropped (note lands at root) rather than 403 on push.
    const orphanNote = await makeStoredNote(A, {
      id: 'note2',
      title: 'Orphan',
      content: 'y',
      folder_id: 'missing-folder'
    });

    const payload = await buildPortablePayload(
      A,
      [noteWithDangling, orphanNote],
      folders,
      tags,
      '2026-06-25T00:00:00.000Z'
    );
    const wire = await reencryptPortablePayload(B, payload, 'user-B', seqIds());

    // Every emitted ID is fresh - none reuses a source ID (which would collide
    // with account A's records on the server and 403 the push).
    const sourceIds = new Set(['parent', 'child', 'tagA', 'note1', 'note2']);
    for (const rec of [...wire.folders, ...wire.tags, ...wire.notes]) {
      expect(sourceIds.has(String(rec.id))).toBe(false);
    }

    // Index folders/notes by their decrypted name/title to assert relationships.
    const folderByName: Record<string, Record<string, unknown>> = {};
    for (const f of wire.folders) folderByName[await B.decryptText(field(f, 'name_encrypted'))] = f;
    const noteByTitle: Record<string, Record<string, unknown>> = {};
    for (const nn of wire.notes) noteByTitle[await B.decryptText(field(nn, 'title_encrypted'))] = nn;

    // parent_id of the child folder points at the parent's NEW id.
    expect(folderByName['Child'].parent_id).toBe(String(folderByName['Parent'].id));
    expect(folderByName['Parent'].parent_id).toBeUndefined();

    // Note in the child folder: folder_id remapped, dangling 'ghost' tag dropped,
    // known tag remapped to its new id.
    const newTagId = String(wire.tags[0].id);
    const inChild = noteByTitle['In child'];
    expect(inChild.folder_id).toBe(String(folderByName['Child'].id));
    const meta = await B.decryptObject<NoteSensitiveMetadata>(field(inChild, 'metadata_encrypted'));
    expect(meta.tags).toEqual([newTagId]); // 'ghost' dropped, 'tagA' remapped

    // Orphan note: folder_id pointing at a folder not in the backup is dropped.
    expect(noteByTitle['Orphan'].folder_id).toBeUndefined();
  });

  it('defaults pin/star/tags for a note with no metadata, and omits tag color when absent', async () => {
    const notes = [await makeStoredNote(A, { id: 'n1', title: 'Plain', content: '' })];
    const tags = [await makeStoredTag(A, { id: 't1', name: 'nocolor' })];
    const payload = await buildPortablePayload(A, notes, [], tags, '2026-06-25T00:00:00.000Z');
    const wire = await reencryptPortablePayload(B, payload, 'user-B', seqIds());

    const meta = await B.decryptObject<NoteSensitiveMetadata>(
      field(wire.notes[0], 'metadata_encrypted')
    );
    expect(meta).toEqual({ is_pinned: false, is_starred: false, tags: [] });
    expect(wire.tags[0].color_encrypted).toBeUndefined();
  });

  it('survives a locally-corrupt note (undecryptable on its own account) via fallback title', async () => {
    // Simulate a corrupt row: ciphertext from a different account that A can't read.
    const note = (await makeStoredNote(A, { id: 'n1', title: 'ok', content: 'ok' })) as NoteStoredLocal;
    note.title_encrypted = 'accountX::txt::garbage';
    const portable = await noteToPortable(A, note);
    expect(portable.title).toBe('Untitled');
  });
});

describe('decryptFieldOr', () => {
  it('returns the fallback for empty or undecryptable input, decrypts otherwise', async () => {
    expect(await decryptFieldOr(A, undefined, 'fb')).toBe('fb');
    expect(await decryptFieldOr(A, '', 'fb')).toBe('fb');
    expect(await decryptFieldOr(A, 'accountB::txt::x', 'fb')).toBe('fb'); // wrong account
    expect(await decryptFieldOr(A, await A.encryptText('real'), 'fb')).toBe('real');
  });
});
