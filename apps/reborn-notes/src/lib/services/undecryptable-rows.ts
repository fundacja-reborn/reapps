/**
 * Shared codec + session cache for rows whose ciphertext does not decrypt with
 * the current master key (foreign key epoch / corrupted data).
 *
 * The pattern (guideline 63, #15 - introduced for saved searches, generalized
 * to folders / tags / notes):
 *   1. The codec distinguishes present-but-undecryptable ciphertext (`null`)
 *      from legal absence (`''`), so callers can tell corruption apart from a
 *      simply empty field.
 *   2. Any failed field marks the WHOLE row `decrypt_failed` with degraded
 *      fields; the UI renders an explicit placeholder instead of a blank row.
 *   3. A session-scoped cache (id -> updated_at it failed at) skips
 *      re-decryption on later refreshes - refreshes run after every sync pull
 *      and re-decode every row, so without the cache a permanently
 *      undecryptable row would repeat the same crypto-layer console errors on
 *      each cycle. The errors surface once per session instead.
 *   4. A rewritten row (new updated_at, e.g. repaired from a device holding
 *      the right key) misses the cache, is retried, and unflagged when it
 *      decodes again.
 */
import { cryptoManager } from '@reborn/crypto';

/**
 * Decrypt a text field. `''` = legally absent; `null` = present but
 * undecryptable (wrong key epoch / corruption). `what` names the field in the
 * not-unlocked error message (a programming error, not a data error).
 */
export async function decodeTextField(
  stored: string | undefined,
  what: string
): Promise<string | null> {
  if (!stored) return '';
  if (!cryptoManager.isInitialized()) {
    throw new Error(`[E2E] decode ${what} called without master key loaded`);
  }
  try {
    return await cryptoManager.decryptText(stored);
  } catch {
    return null;
  }
}

export interface UndecryptableRowCache {
  /** True when `id` already failed at exactly this `updated_at` - skip re-decrypting. */
  has(id: string, updatedAt: string): boolean;
  /** Remember that `id` failed to decrypt at `updatedAt`. */
  mark(id: string, updatedAt: string): void;
  /**
   * Forget `id` - call when the row decoded fully. Callers that decode only a
   * subset of the row's fields (e.g. the note title-only path) must NOT clear:
   * they cannot prove the fields they skipped are healthy. Not clearing is
   * safe - `has()` matches on the exact updated_at, so a rewritten row is
   * retried regardless of a stale entry.
   */
  clear(id: string): void;
}

/**
 * One cache per entity service, module-scoped there so it survives store
 * refreshes for the whole session (cleared only by a page reload).
 */
export function createUndecryptableRowCache(): UndecryptableRowCache {
  const failedAt = new Map<string, string>();
  return {
    has: (id, updatedAt) => failedAt.get(id) === updatedAt,
    mark: (id, updatedAt) => {
      failedAt.set(id, updatedAt);
    },
    clear: (id) => {
      failedAt.delete(id);
    }
  };
}
