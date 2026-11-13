import { describe, it, expect } from 'vitest';
import { MAX_ENCRYPTED_NOTE_METADATA_BYTES, type NoteSensitiveMetadata } from '@reborn/types';
import {
  NOTE_METADATA_BLOCK_BYTES,
  decodeNoteMetadata,
  encodeNoteMetadata,
  isValidNoteColor,
  readNoteColor,
  withNoteColor,
  type NoteMetadataCrypto
} from './note-metadata';
import { APPEARANCE_COLORS } from '$lib/utils/appearance-colors';
import { withArchivedAt } from './archive-marker';

/**
 * Length-preserving fake: like AES-GCM, ciphertext length is a function of
 * the plaintext length only. Tagged so a foreign/corrupt value fails to decrypt.
 */
const fakeCrypto: NoteMetadataCrypto = {
  encryptText: async (text) => `iv:${Buffer.from(text, 'utf8').toString('base64')}`,
  decryptText: async (ct) => {
    if (!ct.startsWith('iv:')) throw new Error('decrypt failed');
    return Buffer.from(ct.slice(3), 'base64').toString('utf8');
  }
};

const plaintextOf = async (ct: string) => fakeCrypto.decryptText(ct);
const byteLength = (s: string) => new TextEncoder().encode(s).length;
const TAG = '123e4567-e89b-12d3-a456-426614174000';

describe('encodeNoteMetadata - Zero Knowledge padding', () => {
  it('hides the color, the star and the pin at every tag count', async () => {
    // Length may depend on how many tags a note has and on whether it is a
    // periodic note - never on its color, star, pin or periodic kind.
    for (let tagCount = 0; tagCount <= 12; tagCount++) {
      for (const periodic of [false, true]) {
        const lengths = new Set<number>();
        for (const color of [undefined, ...APPEARANCE_COLORS]) {
          for (const is_starred of [true, false, undefined]) {
            for (const is_pinned of [true, false, undefined]) {
              for (const kind of ['daily', 'weekly', 'monthly'] as const) {
                const meta: NoteSensitiveMetadata = withNoteColor(
                  {
                    ...(is_starred === undefined ? {} : { is_starred }),
                    ...(is_pinned === undefined ? {} : { is_pinned }),
                    tags: Array(tagCount).fill(TAG),
                    ...(periodic ? { periodic: { kind, anchor: '2026-11-09' } } : {})
                  },
                  color
                );
                lengths.add((await encodeNoteMetadata(fakeCrypto, meta)).length);
              }
            }
          }
        }
        expect(lengths.size, `${tagCount} tags, periodic=${periodic}`).toBe(1);
      }
    }
  });

  it('hides the archive marker at every tag count', async () => {
    // Archiving and restoring rewrite the bundle; the length must not move.
    for (let tagCount = 0; tagCount <= 12; tagCount++) {
      for (const periodic of [false, true]) {
        const base: NoteSensitiveMetadata = {
          is_pinned: false,
          is_starred: true,
          tags: Array(tagCount).fill(TAG),
          color: 'red',
          ...(periodic ? { periodic: { kind: 'daily' as const, anchor: '2026-11-09' } } : {})
        };
        const active = await encodeNoteMetadata(fakeCrypto, base);
        const archived = await encodeNoteMetadata(
          fakeCrypto,
          withArchivedAt(base, '2026-11-13T09:27:41.123Z')
        );
        expect(archived.length, `${tagCount} tags, periodic=${periodic}`).toBe(active.length);
      }
    }
  });

  it('fits a note without tags in one block, archived or not', async () => {
    const meta: NoteSensitiveMetadata = { is_pinned: false, is_starred: false, color: 'orange' };
    for (const m of [meta, withArchivedAt(meta, new Date().toISOString())]) {
      const ct = await encodeNoteMetadata(fakeCrypto, m);
      expect(byteLength(await plaintextOf(ct))).toBe(NOTE_METADATA_BLOCK_BYTES);
    }
  });

  it('keeps the archive marker through a read-modify-write of another field', async () => {
    const at = '2026-11-13T09:27:41.123Z';
    const ct = await encodeNoteMetadata(fakeCrypto, { is_starred: false, archived_at: at });
    // What togglePin / the tag writers do: decode, change one field, re-encode.
    const decoded = (await decodeNoteMetadata(fakeCrypto, ct))!;
    decoded.is_pinned = true;
    const again = await decodeNoteMetadata(fakeCrypto, await encodeNoteMetadata(fakeCrypto, decoded));
    expect(again).toEqual({ is_starred: false, is_pinned: true, archived_at: at });
  });

  it('pads the plaintext to whole blocks', async () => {
    const ct = await encodeNoteMetadata(fakeCrypto, { is_pinned: true, color: 'red' });
    expect(byteLength(await plaintextOf(ct)) % NOTE_METADATA_BLOCK_BYTES).toBe(0);
  });

  it('replaces a stale filler from a decoded bundle instead of padding twice', async () => {
    const first = await encodeNoteMetadata(fakeCrypto, { is_starred: true, color: 'blue' });
    // Older readers (decryptObject) see the filler as a plain field and carry
    // it into their read-modify-write.
    const asOldReaderSeesIt = JSON.parse(await plaintextOf(first)) as NoteSensitiveMetadata;
    expect(asOldReaderSeesIt).toHaveProperty('_pad');
    const again = await encodeNoteMetadata(fakeCrypto, asOldReaderSeesIt);
    expect(again).toBe(first);
  });

  it('falls back to the unpadded JSON when padding would cross the server limit', async () => {
    // Find a tag count whose unpadded bundle fits the server limit while the
    // padded one would not (a window of a few dozen bytes below the limit).
    let meta: NoteSensitiveMetadata | null = null;
    for (let n = 1; n < 400 && !meta; n++) {
      const candidate: NoteSensitiveMetadata = { tags: Array(n).fill(TAG) };
      const unpadded = await fakeCrypto.encryptText(JSON.stringify(candidate));
      const padded = await encodeNoteMetadata(fakeCrypto, candidate);
      if (unpadded.length <= MAX_ENCRYPTED_NOTE_METADATA_BYTES && padded === unpadded) {
        meta = candidate;
      }
    }
    expect(meta).not.toBeNull();
    const encoded = await encodeNoteMetadata(fakeCrypto, meta!);
    expect(encoded.length).toBeLessThanOrEqual(MAX_ENCRYPTED_NOTE_METADATA_BYTES);
    expect(await decodeNoteMetadata(fakeCrypto, encoded)).toEqual(meta);
    // Below that size every bundle is padded.
    const small = await encodeNoteMetadata(fakeCrypto, { tags: [TAG] });
    expect(byteLength(await plaintextOf(small)) % NOTE_METADATA_BLOCK_BYTES).toBe(0);
  });
});

describe('decodeNoteMetadata', () => {
  it('round-trips the fields, strips the filler and keeps unknown fields', async () => {
    const meta = { is_pinned: true, tags: [TAG], color: 'green', pinned_order: 3 };
    const ct = await encodeNoteMetadata(fakeCrypto, meta as NoteSensitiveMetadata);
    expect(await decodeNoteMetadata(fakeCrypto, ct)).toEqual(meta);
  });

  it('reads an unpadded bundle written before padding', async () => {
    const legacy = await fakeCrypto.encryptText(JSON.stringify({ is_starred: true, tags: [] }));
    expect(await decodeNoteMetadata(fakeCrypto, legacy)).toEqual({ is_starred: true, tags: [] });
  });

  it('returns {} when absent and null when undecryptable or not an object', async () => {
    expect(await decodeNoteMetadata(fakeCrypto, undefined)).toEqual({});
    expect(await decodeNoteMetadata(fakeCrypto, null)).toEqual({});
    expect(await decodeNoteMetadata(fakeCrypto, 'foreign:ciphertext')).toBeNull();
    expect(await decodeNoteMetadata(fakeCrypto, await fakeCrypto.encryptText('[]'))).toBeNull();
  });
});

describe('color helpers', () => {
  it('readNoteColor keeps a string within the cap (also unknown keys)', () => {
    expect(readNoteColor({ color: 'blue' })).toBe('blue');
    expect(readNoteColor({ color: 'teal' })).toBe('teal');
    expect(readNoteColor({ color: '' })).toBeUndefined();
    expect(readNoteColor({ color: 'x'.repeat(33) })).toBeUndefined();
    expect(readNoteColor({ color: 5 } as unknown as NoteSensitiveMetadata)).toBeUndefined();
    expect(readNoteColor(null)).toBeUndefined();
  });

  it('isValidNoteColor accepts palette keys and undefined only', () => {
    expect(isValidNoteColor(undefined)).toBe(true);
    expect(isValidNoteColor('violet')).toBe(true);
    expect(isValidNoteColor('#ff0000')).toBe(false);
    expect(isValidNoteColor('teal')).toBe(false);
  });

  it('withNoteColor sets or removes the color and keeps the rest, without mutating', () => {
    const meta: NoteSensitiveMetadata = { is_starred: true, tags: [TAG], color: 'red' };
    expect(withNoteColor(meta, 'blue')).toEqual({ is_starred: true, tags: [TAG], color: 'blue' });
    expect(withNoteColor(meta, undefined)).toEqual({ is_starred: true, tags: [TAG] });
    expect(meta.color).toBe('red');
  });
});
