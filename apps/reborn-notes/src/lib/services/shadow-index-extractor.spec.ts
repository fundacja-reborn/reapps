import { describe, it, expect, vi } from 'vitest';
import {
  extractShadowIndexes,
  CryptoNotReadyError,
  type ShadowIndexCryptoBackend
} from './shadow-index-extractor';

function makeCrypto(opts: {
  ready: boolean;
  decrypt?: () => Promise<unknown>;
}): ShadowIndexCryptoBackend {
  return {
    isInitialized: () => opts.ready,
    decryptObject: opts.decrypt
      ? (vi.fn(opts.decrypt) as ShadowIndexCryptoBackend['decryptObject'])
      : vi.fn().mockRejectedValue(new Error('unexpected decryptObject call'))
  };
}

describe('extractShadowIndexes', () => {
  it('throws CryptoNotReadyError when crypto manager is not initialized', async () => {
    const crypto = makeCrypto({ ready: false });
    await expect(extractShadowIndexes('iv:cipher', crypto)).rejects.toBeInstanceOf(
      CryptoNotReadyError
    );
  });

  it('propagates the error thrown by decryptObject', async () => {
    const crypto = makeCrypto({
      ready: true,
      decrypt: async () => {
        throw new Error('OperationError');
      }
    });
    await expect(extractShadowIndexes('iv:cipher', crypto)).rejects.toThrow('OperationError');
  });

  it('returns defaults only when metadata_encrypted is null/empty (backward-compat)', async () => {
    const crypto = makeCrypto({ ready: true });
    for (const empty of [null, undefined, '']) {
      const result = await extractShadowIndexes(empty as string | null | undefined, crypto);
      expect(result).toEqual({ is_pinned: false, is_starred: false, tagIds: [] });
    }
    expect(crypto.decryptObject).not.toHaveBeenCalled();
  });

  it('returns decoded fields with sensible defaults for missing keys', async () => {
    const crypto = makeCrypto({
      ready: true,
      decrypt: async () => ({ is_pinned: true, is_starred: false, tags: ['t1', 't2'] })
    });
    const result = await extractShadowIndexes('iv:cipher', crypto);
    expect(result).toEqual({ is_pinned: true, is_starred: false, tagIds: ['t1', 't2'] });

    const cryptoNoTags = makeCrypto({
      ready: true,
      decrypt: async () => ({})
    });
    const empty = await extractShadowIndexes('iv:cipher', cryptoNoTags);
    expect(empty).toEqual({ is_pinned: false, is_starred: false, tagIds: [] });
  });
});
