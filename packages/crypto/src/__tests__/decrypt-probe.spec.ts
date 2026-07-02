import { describe, it, expect, vi } from 'vitest';
import { isEncryptedDataReadable } from '../decrypt-probe';

/**
 * Shared cross-key probe. Callers pass one representative ciphertext per
 * entity kind (e.g. [folder name, note title, tag name]); `undefined`/`null`
 * stand in for "this entity kind has no rows".
 */
describe('isEncryptedDataReadable (cross-account/cross-key probe)', () => {
  const decryptOk = async (ct: string) => `plain:${ct}`;
  const decryptFail = async () => {
    throw new Error('OperationError'); // AES-GCM auth-tag mismatch (wrong key)
  };

  it('returns true and stops at the first decryptable probe (same key)', async () => {
    const decrypt = vi.fn(decryptOk);
    expect(await isEncryptedDataReadable(['a', 'b', 'c'], decrypt)).toBe(true);
    // One successful decrypt is enough - no need to probe the other kinds.
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('returns false when no probe decrypts (cross-key data set)', async () => {
    const decrypt = vi.fn(decryptFail);
    expect(await isEncryptedDataReadable(['a', 'b', 'c'], decrypt)).toBe(false);
    expect(decrypt).toHaveBeenCalledTimes(3);
  });

  it('skips empty/missing probes and tries the next entity kind', async () => {
    // Only the last entity kind has rows and it decrypts fine.
    const decrypt = vi.fn(decryptOk);
    expect(await isEncryptedDataReadable([undefined, null, 's'], decrypt)).toBe(true);
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledWith('s');
  });

  it('treats an empty data set as readable without probing', async () => {
    const decrypt = vi.fn(decryptFail);
    expect(await isEncryptedDataReadable([undefined, null, undefined], decrypt)).toBe(true);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('ignores empty-string probes (field present but blank)', async () => {
    const decrypt = vi.fn(decryptFail);
    expect(await isEncryptedDataReadable(['', ''], decrypt)).toBe(true);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('falls through a corrupt leading probe to a valid later one (same key)', async () => {
    // First field corrupt, but a later kind decrypts → still the current key.
    const decrypt = vi.fn(async (ct: string) => {
      if (ct === 'bad') throw new Error('OperationError');
      return `plain:${ct}`;
    });
    expect(await isEncryptedDataReadable(['bad', 'good'], decrypt)).toBe(true);
    expect(decrypt).toHaveBeenCalledTimes(2);
  });
});
