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
    const wire = await reencryptPortablePayload(B, payload, 'user-B');

    const n = wire.notes[0];
    // Target account (B) can read every re-encrypted field...
    expect(await B.decryptText(field(n, 'title_encrypted'))).toBe('Secret title');
    expect(await B.decryptText(field(n, 'content_encrypted'))).toBe('Secret body');
    const meta = await B.decryptObject<NoteSensitiveMetadata>(field(n, 'metadata_encrypted'));
    expect(meta).toEqual({ is_pinned: true, is_starred: true, tags: ['t1'] });

    // ...the source account (A) cannot (the bug being fixed: A-key ciphertext
    // used to survive untouched and was unreadable on B).
    await expect(A.decryptText(field(n, 'title_encrypted'))).rejects.toThrow();

    // Ownership transferred, structural fields preserved, sync reset to pending.
    expect(n.id).toBe('n1');
    expect(n.user_id).toBe('user-B');
    expect(n.folder_id).toBe('f1');
    expect(n.is_archived).toBe(false);
    expect(n.created_at).toBe('2026-03-01T00:00:00.000Z');
    expect(n.updated_at).toBe('2026-03-02T00:00:00.000Z');
    expect(n.sync_status).toBe('pending');
    expect(n.sync_version).toBe(0);

    const f = wire.folders[0];
    expect(await B.decryptText(field(f, 'name_encrypted'))).toBe('Folder name');
    expect(f.user_id).toBe('user-B');

    const t = wire.tags[0];
    expect(await B.decryptText(field(t, 'name_encrypted'))).toBe('tagname');
    expect(await B.decryptText(field(t, 'color_encrypted'))).toBe('#00FF00');
    expect(t.user_id).toBe('user-B');
  });

  it('defaults pin/star/tags for a note with no metadata, and omits tag color when absent', async () => {
    const notes = [await makeStoredNote(A, { id: 'n1', title: 'Plain', content: '' })];
    const tags = [await makeStoredTag(A, { id: 't1', name: 'nocolor' })];
    const payload = await buildPortablePayload(A, notes, [], tags, '2026-06-25T00:00:00.000Z');
    const wire = await reencryptPortablePayload(B, payload, 'user-B');

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
