/**
 * Push-error classification for notes sync.
 *
 * Separates a *permanent* rejection (a 4xx the client cannot fix by retrying)
 * from a *transient* failure (server/network hiccup, retry later). Kept in its
 * own module so it can be unit-tested without the browser-only dependencies the
 * sync service drags in (IndexedDB, cryptoManager, $env). See guideline 36,
 * rule 14.
 */
import type { SyncErrorCode } from '@reborn/types';

/**
 * Statuses where retrying the same payload can never succeed - the request
 * itself is the problem. Deliberately an explicit allowlist, NOT "every 4xx",
 * because several 4xx codes ARE transient for push:
 *   - 401: session problem; authFetch handles refresh+retry then flips
 *     sessionExpired. Treating it as permanent would falsely poison the note.
 *   - 404: a note POST whose folder_id hasn't reached the server yet (push
 *     ordering) - resolves once the folder lands.
 *   - 408 / 429: timeout / rate-limit - transient by definition.
 * 413 (too large / quota full), 400 (Zod validation) and 403 (ownership) cannot
 * be fixed by re-sending the same bytes, so they are permanent.
 */
export const PERMANENT_PUSH_STATUSES = new Set([400, 403, 413]);

export function isPermanentStatus(status: number): boolean {
  return PERMANENT_PUSH_STATUSES.has(status);
}

/** Thrown by `ensureOk` for a permanent (non-retryable) HTTP rejection. */
export class HttpPushError extends Error {
  constructor(
    readonly status: number,
    readonly code: SyncErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'HttpPushError';
  }
}

/**
 * Assert a push response is OK, otherwise throw the right error:
 *   - permanent status -> `HttpPushError` (skips retry; for notes, marks the
 *     entity sync_error so it stops re-pushing forever),
 *   - anything else -> a plain `Error`, retried with backoff and left 'pending'.
 *
 * For 413 we peek at the body to separate a full storage quota
 * (`QUOTA_EXCEEDED`) from an oversized single payload, so the UI can say which.
 */
export async function ensureOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  if (!isPermanentStatus(res.status)) {
    throw new Error(`${label}: ${res.status}`);
  }
  let code: SyncErrorCode =
    res.status === 413 ? 'too_large' : res.status === 400 ? 'invalid' : 'rejected';
  if (res.status === 413) {
    try {
      const body = await res.clone().json();
      if (body?.error === 'QUOTA_EXCEEDED') code = 'quota_exceeded';
    } catch {
      // Empty / non-JSON body (e.g. the adapter's plain 413) - keep 'too_large'.
    }
  }
  throw new HttpPushError(res.status, code, `${label}: ${res.status}`);
}
