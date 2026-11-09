import { describe, it, expect } from 'vitest';
import {
  FOLDER_METADATA_BLOCK_BYTES,
  compareFolderMetadataOnPull,
  decodeFolderMetadata,
  encodeFolderMetadata,
  isValidAppearancePatch,
  mergeFolderAppearance,
  padFolderMetadataJson,
  readFolderAppearance,
  type FolderMetadataCrypto
} from './folder-metadata';
import { APPEARANCE_COLORS } from '$lib/utils/appearance-colors';
import { FOLDER_ICONS } from '$lib/utils/folder-icons';

/**
 * Length-preserving fake: like AES-GCM, ciphertext length is a function of
 * the plaintext length only. Tagged so a foreign/corrupt value fails to decrypt.
 */
const fakeCrypto: FolderMetadataCrypto = {
  encryptText: async (text) => `iv:${Buffer.from(text, 'utf8').toString('base64')}`,
  decryptText: async (ct) => {
    if (!ct.startsWith('iv:')) throw new Error('decrypt failed');
    return Buffer.from(ct.slice(3), 'base64').toString('utf8');
  }
};

const byteLength = (s: string) => new TextEncoder().encode(s).length;

describe('padFolderMetadataJson', () => {
  it('pads every bundle the app writes to exactly one block', () => {
    const bundles = [
      {},
      { color: 'red' },
      { icon: 'house' },
      { color: 'orange', icon: 'graduation-cap' },
      { color: 'violet', icon: 'shopping-cart' }
    ];
    for (const b of bundles) {
      expect(byteLength(padFolderMetadataJson(b))).toBe(FOLDER_METADATA_BLOCK_BYTES);
    }
  });

  it('covers the longest color + icon combination within one block', () => {
    const longestColor = [...APPEARANCE_COLORS].sort((a, b) => b.length - a.length)[0];
    const longestIcon = [...FOLDER_ICONS].sort((a, b) => b.length - a.length)[0];
    const json = padFolderMetadataJson({ color: longestColor, icon: longestIcon });
    expect(byteLength(json)).toBe(FOLDER_METADATA_BLOCK_BYTES);
  });

  it('steps up by whole blocks for a larger bundle, counting UTF-8 bytes', () => {
    const json = padFolderMetadataJson({ color: 'red', note: 'ż'.repeat(80) });
    expect(byteLength(json) % FOLDER_METADATA_BLOCK_BYTES).toBe(0);
    expect(byteLength(json)).toBe(2 * FOLDER_METADATA_BLOCK_BYTES);
    expect(JSON.parse(json).note).toBe('ż'.repeat(80));
  });

  it('replaces a stale filler instead of padding twice', () => {
    const once = padFolderMetadataJson({ color: 'red' });
    expect(padFolderMetadataJson(JSON.parse(once))).toBe(once);
  });
});

describe('encode / decode', () => {
  it('hides which color/icon is set: equal ciphertext length for every choice', async () => {
    const lengths = new Set<number>();
    for (const color of [undefined, ...APPEARANCE_COLORS]) {
      for (const icon of [undefined, ...FOLDER_ICONS]) {
        const bundle = mergeFolderAppearance({}, { color, icon });
        lengths.add((await encodeFolderMetadata(fakeCrypto, bundle)).length);
      }
    }
    expect(lengths.size).toBe(1);
  });

  it('round-trips the fields and strips the filler', async () => {
    const ct = await encodeFolderMetadata(fakeCrypto, { color: 'blue', icon: 'leaf' });
    expect(await decodeFolderMetadata(fakeCrypto, ct)).toEqual({ color: 'blue', icon: 'leaf' });
  });

  it('keeps unknown fields from a newer app version', async () => {
    const ct = await encodeFolderMetadata(fakeCrypto, { color: 'blue', pinned: true });
    expect(await decodeFolderMetadata(fakeCrypto, ct)).toEqual({ color: 'blue', pinned: true });
  });

  it('returns {} when absent and null when undecryptable or not an object', async () => {
    expect(await decodeFolderMetadata(fakeCrypto, undefined)).toEqual({});
    expect(await decodeFolderMetadata(fakeCrypto, null)).toEqual({});
    expect(await decodeFolderMetadata(fakeCrypto, 'foreign:ciphertext')).toBeNull();
    expect(
      await decodeFolderMetadata(fakeCrypto, await fakeCrypto.encryptText('not json'))
    ).toBeNull();
    expect(
      await decodeFolderMetadata(fakeCrypto, await fakeCrypto.encryptText('[1,2]'))
    ).toBeNull();
    expect(await decodeFolderMetadata(fakeCrypto, await fakeCrypto.encryptText('"x"'))).toBeNull();
  });
});

describe('readFolderAppearance', () => {
  it('keeps string values (also unknown keys - the renderer falls back)', () => {
    expect(readFolderAppearance({ color: 'teal', icon: 'rocket' })).toEqual({
      color: 'teal',
      icon: 'rocket'
    });
  });

  it('drops non-strings and oversized values', () => {
    expect(readFolderAppearance({ color: 5, icon: 'x'.repeat(65) })).toEqual({});
    expect(readFolderAppearance(null)).toEqual({});
  });
});

describe('mergeFolderAppearance', () => {
  it('sets, clears with undefined, and keeps fields the patch does not name', () => {
    const existing = { color: 'red', icon: 'house', pinned: true };
    expect(mergeFolderAppearance(existing, { color: 'blue' })).toEqual({
      color: 'blue',
      icon: 'house',
      pinned: true
    });
    expect(mergeFolderAppearance(existing, { icon: undefined })).toEqual({
      color: 'red',
      pinned: true
    });
    // The input is not mutated.
    expect(existing).toEqual({ color: 'red', icon: 'house', pinned: true });
  });
});

describe('isValidAppearancePatch', () => {
  it('accepts keys from the closed sets and undefined (reset)', () => {
    expect(isValidAppearancePatch({ color: 'yellow', icon: 'wallet' })).toBe(true);
    expect(isValidAppearancePatch({ color: undefined, icon: undefined })).toBe(true);
    expect(isValidAppearancePatch({})).toBe(true);
  });

  it('rejects a hex value or an arbitrary icon name', () => {
    expect(isValidAppearancePatch({ color: '#ff0000' })).toBe(false);
    expect(isValidAppearancePatch({ icon: 'rocket' })).toBe(false);
  });
});

describe('compareFolderMetadataOnPull', () => {
  it('ignores a server that predates the field', () => {
    expect(compareFolderMetadataOnPull('iv:a', undefined)).toBe('same');
    expect(compareFolderMetadataOnPull(undefined, undefined)).toBe('same');
  });

  it('adopts a server bundle the local row lacks', () => {
    expect(compareFolderMetadataOnPull(undefined, 'iv:a')).toBe('adopt');
    expect(compareFolderMetadataOnPull(null, 'iv:a')).toBe('adopt');
  });

  it('treats a local bundle the server lacks or differs from as an unpushed edit', () => {
    expect(compareFolderMetadataOnPull('iv:a', null)).toBe('local-edit');
    expect(compareFolderMetadataOnPull('iv:a', 'iv:b')).toBe('local-edit');
  });

  it('reports equal values as the same', () => {
    expect(compareFolderMetadataOnPull('iv:a', 'iv:a')).toBe('same');
    expect(compareFolderMetadataOnPull(undefined, null)).toBe('same');
  });
});
