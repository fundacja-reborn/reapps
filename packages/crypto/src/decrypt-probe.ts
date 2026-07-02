/**
 * Probe whether a set of ciphertexts is readable under the CURRENT master key.
 *
 * Account-key ciphertext decrypts only with the key that produced it. Data
 * that reaches a device under a DIFFERENT key - an encrypted backup imported
 * on the wrong account, or IndexedDB rows left behind when the peer app
 * switched the shared origin key to another account - fails the AES-GCM auth
 * tag on every field. Handled blindly it surfaces as blank rows, default
 * shadow indexes and per-record sync rejections, or worse: permanently
 * undecryptable records pushed to the server. Callers use this probe to
 * detect the mismatch up front and refuse / recover instead.
 *
 * This module is a pure probe (crypto injected) so it unit-tests without a
 * CryptoManager or IndexedDB. Zero Knowledge: it only attempts local
 * decryption; no plaintext, keys, or server contact leave.
 */

/**
 * True if AT LEAST ONE probe ciphertext decrypts with the current key - i.e.
 * the data belongs to this account/key and is safe to process. False means
 * none decrypted: a cross-account/cross-key data set.
 *
 * Pass one representative ciphertext per entity kind (e.g. folder name, note
 * title, tag name): a cross-key data set fails on every field, while a
 * same-key set decrypts on the first probe. A leading corrupt field falls
 * through to the next probe, so a lone bad row can't misflag an otherwise
 * readable set. An empty set (no probes) is trivially readable - there is
 * nothing to misread.
 *
 * `decrypt` rejects on an authentication-tag mismatch (wrong key) or
 * malformed input; both count as "this probe did not decrypt" and the next
 * one is tried.
 */
export async function isEncryptedDataReadable(
  probes: ReadonlyArray<string | undefined | null>,
  decrypt: (ciphertext: string) => Promise<string>
): Promise<boolean> {
  const candidates = probes.filter(
    (c): c is string => typeof c === 'string' && c.length > 0
  );
  if (candidates.length === 0) return true;
  for (const ciphertext of candidates) {
    try {
      await decrypt(ciphertext);
      return true;
    } catch {
      // Wrong key / corrupt field - try the next probe.
    }
  }
  return false;
}
