/**
 * Push-error classification for the task offline-operation queue.
 *
 * Separates a *permanent* rejection (a 4xx the client cannot fix by retrying)
 * from a *transient* failure (server/network hiccup, retry later). The notes
 * app has the same logic in `push-error.ts`; here it is adapted to the
 * `ApiClient` response shape ({ success, status, error }) the sync services
 * already receive, and kept in its own module so it can be unit-tested without
 * the browser-only dependencies the sync engine drags in. See guideline 36,
 * rule 14.
 */
import type { SyncErrorCode } from '@reborn/types';

/**
 * Statuses where retrying the same payload can never succeed - the request
 * itself is the problem. Deliberately an explicit allowlist, NOT "every 4xx",
 * because several 4xx codes ARE transient for a push:
 *   - 401: session problem; ApiClient.onUnauthorized handles refresh+retry then
 *     flips sessionExpired. Treating it as permanent would falsely poison the op.
 *   - 404: a create whose parent (list/task) hasn't reached the server yet
 *     (push ordering) - resolves once the parent lands.
 *   - 408 / 429: timeout / rate-limit - transient by definition.
 * 413 (too large), 400 (Zod validation) and 403 (ownership) cannot be fixed by
 * re-sending the same bytes, so they are permanent.
 */
export const PERMANENT_PUSH_STATUSES = new Set([400, 403, 413]);

export function isPermanentStatus(status: number): boolean {
	return PERMANENT_PUSH_STATUSES.has(status);
}

/** Thrown by `ensureOperationOk` for a permanent (non-retryable) HTTP rejection. */
export class PermanentOperationError extends Error {
	constructor(
		readonly status: number,
		readonly code: SyncErrorCode,
		message: string
	) {
		super(message);
		this.name = 'PermanentOperationError';
	}
}

/** Minimal shape of an ApiClient response that this module reasons about. */
export interface ClassifiableResponse {
	success: boolean;
	status?: number;
	error?: string;
	message?: string;
}

/**
 * Map a permanent status (+ body) to a SyncErrorCode. For 413 we look at the
 * body to separate a full storage quota (`QUOTA_EXCEEDED`) from an oversized
 * single payload, so the UI can say which (parity with notes; task has no quota
 * endpoint today, so 413 is effectively always `too_large`).
 */
function codeForStatus(status: number, errorBody?: string): SyncErrorCode {
	if (status === 413) return errorBody === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'too_large';
	if (status === 400) return 'invalid';
	return 'rejected'; // 403 and any other permanent status
}

/**
 * Assert an ApiClient response is OK, otherwise throw the right error:
 *   - permanent status -> `PermanentOperationError` (skips retry; the queue
 *     dead-letters the op and marks the entity sync_error so it stops
 *     re-pushing forever),
 *   - anything else -> a plain `Error`, left in the queue as today.
 */
export function ensureOperationOk(response: ClassifiableResponse, label: string): void {
	if (response.success) return;
	const status = response.status ?? 0;
	if (isPermanentStatus(status)) {
		throw new PermanentOperationError(
			status,
			codeForStatus(status, response.error),
			`${label}: ${status}`
		);
	}
	throw new Error(response.error || response.message || `${label}: ${status || 'failed'}`);
}
