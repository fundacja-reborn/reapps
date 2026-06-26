/**
 * Pure transforms for the portable encrypted backup (envelope version 3,
 * "plaintext-inside"). Kept in a light module - importing only types and a pure
 * sibling util (note-link rewriting) - so the crypto round-trip can be
 * unit-tested without pulling the full export/import service (stores, JSZip,
 * DOMPurify, ...). Mirrors the split used by `export-import-trash-utils.ts`.
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
import { remapNoteLinks } from './note-link-utils';

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
 * Default ID generator for re-imported entities: the global Web Crypto
 * `randomUUID`. Referenced through `globalThis` because this module's transform
 * functions take a parameter named `crypto` (the injected {@link PortableCrypto})
 * which would otherwise shadow the global. Injectable so tests stay deterministic.
 */
function defaultNewId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Re-encrypt a decrypted {@link PortablePayload} with the importing account's
 * key, producing the same `*_encrypted` wire shape the version 1/2 path yields.
 * The shared import loops then treat all formats identically - which is what
 * makes a v3 backup land readable on any account.
 *
 * Every entity is also given a **fresh ID**, and all foreign keys
 * (`folder.parent_id`, `note.folder_id`, and the tag IDs inside a note's
 * metadata bundle) are remapped to the new IDs. This is mandatory for
 * cross-account portability: the server rejects a write to an `id` already
 * owned by another user with `403 Forbidden` (the ownership guard in every
 * `/api/{notes,folders,tags}` POST handler), so reusing the source account's
 * IDs would make each pushed record bounce ("Rejected by server") even though
 * the local copy is perfectly readable. Fresh IDs make a portable import
 * additive - genuinely new records owned by the target account. Dangling
 * references (a `folder_id` or tag ID whose target is not part of the backup)
 * are dropped rather than carried over as a now-meaningless ID.
 *
 * Because note ids change too, the `note:UUID` links embedded in each note's
 * Markdown body are rewritten to the freshly-minted ids ({@link remapNoteLinks})
 * so note-to-note links keep resolving after a cross-account import. A link to a
 * note that is not part of the backup is left untouched - it would dangle either
 * way, and rewriting only what we can resolve avoids mangling the surrounding
 * Markdown.
 */
export async function reencryptPortablePayload(
  crypto: PortableCrypto,
  payload: PortablePayload,
  userId: string,
  newId: () => string = defaultNewId
): Promise<PortableWireData> {
  const data = payload?.data ?? { notes: [], folders: [], tags: [] };

  // Pre-assign fresh IDs for folders and tags so foreign keys resolve in a
  // single pass regardless of declaration order (a child folder may appear
  // before its parent).
  const folderIdMap = new Map<string, string>();
  for (const f of data.folders ?? []) folderIdMap.set(f.id, newId());
  const tagIdMap = new Map<string, string>();
  for (const t of data.tags ?? []) tagIdMap.set(t.id, newId());
  // Pre-assign note IDs too, so a `note:UUID` link can be remapped to its
  // target's new ID even when the linked note appears later in the array (or
  // links the other way). Minted after folders+tags to keep the assignment
  // order folders -> tags -> notes that the spec's deterministic generator and
  // the existing FK assertions rely on.
  const noteIdMap = new Map<string, string>();
  for (const n of data.notes ?? []) noteIdMap.set(n.id, newId());

  const folders = await Promise.all(
    (data.folders ?? []).map(async (f) => ({
      id: folderIdMap.get(f.id)!,
      user_id: userId,
      parent_id: f.parent_id ? (folderIdMap.get(f.parent_id) ?? undefined) : undefined,
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
      id: tagIdMap.get(t.id)!,
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
      // Remap tag references to the freshly-minted tag IDs; drop any whose tag
      // is not part of this backup (would point at nothing on the new account).
      const remappedTags = (n.tags ?? [])
        .map((tid) => tagIdMap.get(tid))
        .filter((tid): tid is string => Boolean(tid));
      const metadata: NoteSensitiveMetadata = {
        is_pinned: n.is_pinned ?? false,
        is_starred: n.is_starred ?? false,
        tags: remappedTags
      };
      if (n.periodic) metadata.periodic = n.periodic;
      return {
        id: noteIdMap.get(n.id)!,
        user_id: userId,
        folder_id: n.folder_id ? (folderIdMap.get(n.folder_id) ?? undefined) : undefined,
        title_encrypted: await crypto.encryptText(n.title || 'Untitled'),
        content_encrypted: await crypto.encryptText(remapNoteLinks(n.content ?? '', noteIdMap)),
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
