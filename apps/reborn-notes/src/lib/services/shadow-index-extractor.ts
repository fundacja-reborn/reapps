import type { NoteSensitiveMetadata } from '@reborn/types';

export interface ShadowIndexes {
  is_pinned: boolean;
  is_starred: boolean;
  tagIds: string[];
}

/**
 * Minimal crypto surface used by the shadow-index extractor. Keeping this
 * narrow lets the extractor be unit-tested without pulling in the full
 * `@reborn/crypto` package (WASM, IDB key store, key event subsystem).
 */
export interface ShadowIndexCryptoBackend {
  isInitialized(): boolean;
  decryptObject<T>(value: string): Promise<T>;
}

export class CryptoNotReadyError extends Error {
  constructor() {
    super('crypto-not-ready');
    this.name = 'CryptoNotReadyError';
  }
}

/**
 * Decrypt the metadata_encrypted bundle into shadow indexes (is_pinned,
 * is_starred, tag ids). Throws on the two transient failure modes:
 *
 *   1. `cryptoManager` not yet initialized when the call lands (race during
 *      login/unlock or cross-app key event), and
 *   2. AES-GCM rejecting the ciphertext (wrong key, corrupted IV).
 *
 * Callers MUST catch and skip the IDB write. Silently writing defaults of
 * `false/false` here would lock the shadow indexes into a corrupted state:
 * the `sync_version` guard in `pullNotes` skips re-decrypt on subsequent
 * pulls, so only a full logout+login (which clears IDB) would recover.
 *
 * The single non-throwing branch is `metadata_encrypted == null/empty` -
 * backward-compat for very old notes created before the bundle existed.
 */
export async function extractShadowIndexes(
  metadata_encrypted: string | undefined | null,
  crypto: ShadowIndexCryptoBackend
): Promise<ShadowIndexes> {
  if (!metadata_encrypted) {
    return { is_pinned: false, is_starred: false, tagIds: [] };
  }
  if (!crypto.isInitialized()) {
    throw new CryptoNotReadyError();
  }
  const meta = await crypto.decryptObject<NoteSensitiveMetadata>(metadata_encrypted);
  return {
    is_pinned: meta.is_pinned ?? false,
    is_starred: meta.is_starred ?? false,
    tagIds: meta.tags ?? []
  };
}
