/**
 * Pure transforms for the portable encrypted backup (envelope version 3,
 * "plaintext-inside"). Kept in a light module - importing only types - so the
 * crypto round-trip can be unit-tested without pulling the full export/import
 * service (stores, JSZip, DOMPurify, ...). Mirrors the split used by
 * `export-import-trash-utils.ts`.
 *
 * The crypto is injected via {@link PortableCrypto} (satisfied by
 * `cryptoManager`) so tests can simulate two distinct accounts - the whole
 * point of the feature is that a backup decrypted with account A's key
 * re-encrypts cleanly under account B's key.
 *
 * Zero Knowledge: plaintext exists only transiently in memory here, between the
 * account-key decrypt (export) and the password/account-key encrypt (import).
 */
import type {
  NoteStoredLocal,
  NoteSensitiveMetadata,
  PeriodicNoteMetadata,
  FolderEncrypted,
  TagEncrypted
} from '@reborn/types';

/** Minimal crypto surface needed by the transforms (a subset of cryptoManager). */
export interface PortableCrypto {
  encryptText(text: string): Promise<string>;
  decryptText(ciphertext: string): Promise<string>;
  encryptObject<T>(obj: T): Promise<string>;
  decryptObject<T>(ciphertext: string): Promise<T>;
}

/**
 * Decrypted, account-agnostic note for a portable backup. `user_id` is
 * intentionally omitted - ownership is assigned by the importing account.
 */
export interface PortableNote {
  id: string;
  folder_id?: string | null;
  title: string;
  content: string;
  is_archived?: boolean;
  is_pinned?: boolean;
  is_starred?: boolean;
  tags?: string[];
  periodic?: PeriodicNoteMetadata;
  created_at: string;
  updated_at: string;
}

export interface PortableFolder {
  id: string;
  parent_id?: string | null;
  name: string;
  order_index: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface PortableTag {
  id: string;
  name: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface PortablePayload {
  exported_at: string;
  app: 'reborn-notes';
  format: 'plaintext';
  data: { notes: PortableNote[]; folders: PortableFolder[]; tags: PortableTag[] };
}

/** Wire shape consumed by the shared import loops (NoteEncrypted/Folder/Tag-like). */
export interface PortableWireData {
  notes: Record<string, unknown>[];
  folders: Record<string, unknown>[];
  tags: Record<string, unknown>[];
}

/**
 * Best-effort decrypt of one ciphertext field, falling back to `fallback` on
 * any failure. Mirrors folder.service `decodeName`, which returns '' for a
 * locally-corrupt row rather than throwing - so a single bad record can't abort
 * the whole export.
 */
export async function decryptFieldOr(
  crypto: PortableCrypto,
  ciphertext: string | undefined,
  fallback: string
): Promise<string> {
  if (!ciphertext) return fallback;
  try {
    return await crypto.decryptText(ciphertext);
  } catch {
    return fallback;
  }
}

export async function noteToPortable(
  crypto: PortableCrypto,
  note: NoteStoredLocal
): Promise<PortableNote> {
  const title = await decryptFieldOr(crypto, note.title_encrypted, '');
  const content = await decryptFieldOr(crypto, note.content_encrypted, '');
  // is_pinned/is_starred/tags/periodic come from metadata_encrypted, the single
  // source of truth - the local shadow indexes are never trusted (Zero Knowledge).
  let is_pinned = false;
  let is_starred = false;
  let tags: string[] = [];
  let periodic: PeriodicNoteMetadata | undefined;
  if (note.metadata_encrypted) {
    try {
      const meta = await crypto.decryptObject<NoteSensitiveMetadata>(note.metadata_encrypted);
      is_pinned = meta.is_pinned ?? false;
      is_starred = meta.is_starred ?? false;
      tags = meta.tags ?? [];
      periodic = meta.periodic;
    } catch {
      // Leave defaults - a row whose metadata can't be decrypted on its own
      // account is already broken locally; don't abort the export for it.
    }
  }
  return {
    id: note.id,
    folder_id: note.folder_id ?? undefined,
    title: title || 'Untitled',
    content,
    is_archived: note.is_archived ?? false,
    is_pinned,
    is_starred,
    tags,
    ...(periodic ? { periodic } : {}),
    created_at: note.created_at,
    updated_at: note.updated_at
  };
}

export async function folderToPortable(
  crypto: PortableCrypto,
  folder: FolderEncrypted
): Promise<PortableFolder> {
  return {
    id: folder.id,
    parent_id: folder.parent_id ?? undefined,
    name: (await decryptFieldOr(crypto, folder.name_encrypted, '')) || 'Untitled',
    order_index: folder.order_index,
    is_archived: folder.is_archived,
    created_at: folder.created_at,
    updated_at: folder.updated_at
  };
}

export async function tagToPortable(
  crypto: PortableCrypto,
  tag: TagEncrypted
): Promise<PortableTag> {
  const name = (await decryptFieldOr(crypto, tag.name_encrypted, '')) || 'tag';
  const color = tag.color_encrypted ? await decryptFieldOr(crypto, tag.color_encrypted, '') : '';
  return {
    id: tag.id,
    name,
    ...(color ? { color } : {}),
    created_at: tag.created_at,
    updated_at: tag.updated_at
  };
}

/**
 * Build the plaintext payload for a portable export by decrypting every entity
 * with the current account key.
 */
export async function buildPortablePayload(
  crypto: PortableCrypto,
  notes: NoteStoredLocal[],
  folders: FolderEncrypted[],
  tags: TagEncrypted[],
  exportedAt: string
): Promise<PortablePayload> {
  const [portableNotes, portableFolders, portableTags] = await Promise.all([
    Promise.all(notes.map((n) => noteToPortable(crypto, n))),
    Promise.all(folders.map((f) => folderToPortable(crypto, f))),
    Promise.all(tags.map((t) => tagToPortable(crypto, t)))
  ]);
  return {
    exported_at: exportedAt,
    app: 'reborn-notes',
    format: 'plaintext',
    data: { notes: portableNotes, folders: portableFolders, tags: portableTags }
  };
}

/**
 * Re-encrypt a decrypted {@link PortablePayload} with the importing account's
 * key, producing the same `*_encrypted` wire shape the version 1/2 path yields.
 * The shared import loops then treat all formats identically - which is what
 * makes a v3 backup land readable on any account.
 */
export async function reencryptPortablePayload(
  crypto: PortableCrypto,
  payload: PortablePayload,
  userId: string
): Promise<PortableWireData> {
  const data = payload?.data ?? { notes: [], folders: [], tags: [] };

  const folders = await Promise.all(
    (data.folders ?? []).map(async (f) => ({
      id: f.id,
      user_id: userId,
      parent_id: f.parent_id ?? undefined,
      name_encrypted: await crypto.encryptText(f.name || 'Untitled'),
      order_index: f.order_index ?? 0,
      is_archived: f.is_archived ?? false,
      created_at: f.created_at,
      updated_at: f.updated_at,
      sync_status: 'pending',
      sync_version: 0
    }))
  );

  const tags = await Promise.all(
    (data.tags ?? []).map(async (t) => ({
      id: t.id,
      user_id: userId,
      name_encrypted: await crypto.encryptText(t.name || 'tag'),
      ...(t.color ? { color_encrypted: await crypto.encryptText(t.color) } : {}),
      created_at: t.created_at,
      updated_at: t.updated_at,
      sync_status: 'pending',
      sync_version: 0
    }))
  );

  const notes = await Promise.all(
    (data.notes ?? []).map(async (n) => {
      const metadata: NoteSensitiveMetadata = {
        is_pinned: n.is_pinned ?? false,
        is_starred: n.is_starred ?? false,
        tags: n.tags ?? []
      };
      if (n.periodic) metadata.periodic = n.periodic;
      return {
        id: n.id,
        user_id: userId,
        folder_id: n.folder_id ?? undefined,
        title_encrypted: await crypto.encryptText(n.title || 'Untitled'),
        content_encrypted: await crypto.encryptText(n.content ?? ''),
        metadata_encrypted: await crypto.encryptObject<NoteSensitiveMetadata>(metadata),
        is_archived: n.is_archived ?? false,
        created_at: n.created_at,
        updated_at: n.updated_at,
        sync_status: 'pending',
        sync_version: 0
      };
    })
  );

  return { notes, folders, tags };
}
