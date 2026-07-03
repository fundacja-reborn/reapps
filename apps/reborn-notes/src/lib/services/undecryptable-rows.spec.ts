import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared codec + session cache behind the decrypt_failed pattern (guideline 63,
// #15). The per-entity wiring is covered by the service specs (saved-search,
// tag, note); this locks the engine itself.

let cryptoReady = true;
const decryptTextSpy = vi.fn(async (stored: string) => {
  if (stored.startsWith('bad:')) throw new Error('OperationError');
  return stored.replace(/^enc:/, '');
});

vi.mock('@reborn/crypto', () => ({
  cryptoManager: {
    isInitialized: () => cryptoReady,
    decryptText: (stored: string) => decryptTextSpy(stored)
  }
}));

const { decodeTextField, createUndecryptableRowCache } = await import('./undecryptable-rows');

beforeEach(() => {
  cryptoReady = true;
  decryptTextSpy.mockClear();
});

describe('decodeTextField', () => {
  it('returns "" for a legally absent field without touching crypto', async () => {
    expect(await decodeTextField('', 'x')).toBe('');
    expect(await decodeTextField(undefined, 'x')).toBe('');
    expect(decryptTextSpy).not.toHaveBeenCalled();
  });

  it('returns the plaintext for healthy ciphertext', async () => {
    expect(await decodeTextField('enc:Hello', 'x')).toBe('Hello');
  });

  it('returns null (not "") for present-but-undecryptable ciphertext', async () => {
    expect(await decodeTextField('bad:garbage', 'x')).toBeNull();
  });

  it('throws when the master key is not loaded - a programming error, not corruption', async () => {
    cryptoReady = false;
    await expect(decodeTextField('enc:Hello', 'folder name')).rejects.toThrow(
      '[E2E] decode folder name called without master key loaded'
    );
  });
});

describe('createUndecryptableRowCache', () => {
  it('matches only the exact updated_at the row failed at', () => {
    const cache = createUndecryptableRowCache();
    cache.mark('id-1', '2026-06-01');
    expect(cache.has('id-1', '2026-06-01')).toBe(true);
    // Rewritten row (new updated_at) must be retried.
    expect(cache.has('id-1', '2026-06-02')).toBe(false);
    expect(cache.has('id-2', '2026-06-01')).toBe(false);
  });

  it('clear() forgets the row', () => {
    const cache = createUndecryptableRowCache();
    cache.mark('id-1', '2026-06-01');
    cache.clear('id-1');
    expect(cache.has('id-1', '2026-06-01')).toBe(false);
  });

  it('instances are independent (one per entity service)', () => {
    const a = createUndecryptableRowCache();
    const b = createUndecryptableRowCache();
    a.mark('id-1', '2026-06-01');
    expect(b.has('id-1', '2026-06-01')).toBe(false);
  });
});
