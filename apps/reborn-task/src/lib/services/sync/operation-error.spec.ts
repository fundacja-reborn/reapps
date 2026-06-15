import { describe, it, expect } from 'vitest';
import {
	ensureOperationOk,
	isPermanentStatus,
	PermanentOperationError
} from './operation-error';

describe('operation-error classification', () => {
	describe('isPermanentStatus', () => {
		it('treats 400 / 403 / 413 as permanent (payload itself is the problem)', () => {
			expect(isPermanentStatus(400)).toBe(true);
			expect(isPermanentStatus(403)).toBe(true);
			expect(isPermanentStatus(413)).toBe(true);
		});

		it('treats session / ordering / rate-limit 4xx as transient', () => {
			// 401 = session (ApiClient refresh), 404 = parent not on server yet,
			// 408/429 = timeout/rate-limit. None should poison the operation.
			for (const s of [401, 404, 408, 409, 425, 429]) {
				expect(isPermanentStatus(s), `status ${s}`).toBe(false);
			}
		});

		it('treats 5xx as transient', () => {
			for (const s of [500, 502, 503]) expect(isPermanentStatus(s), `status ${s}`).toBe(false);
		});
	});

	describe('ensureOperationOk', () => {
		it('returns for a successful response', () => {
			expect(() => ensureOperationOk({ success: true, status: 200 }, 'POST x')).not.toThrow();
		});

		it('throws a plain Error (retryable, NOT PermanentOperationError) for a transient status', () => {
			let caught: unknown;
			try {
				ensureOperationOk({ success: false, status: 500, error: 'boom' }, 'POST /api/tasks');
			} catch (e) {
				caught = e;
			}
			expect(caught).toBeInstanceOf(Error);
			expect(caught).not.toBeInstanceOf(PermanentOperationError);
			expect((caught as Error).message).toBe('boom');
		});

		it('throws a plain Error when status is missing/unknown (treated as transient)', () => {
			let caught: unknown;
			try {
				ensureOperationOk({ success: false }, 'PUT /api/tasks/1');
			} catch (e) {
				caught = e;
			}
			expect(caught).toBeInstanceOf(Error);
			expect(caught).not.toBeInstanceOf(PermanentOperationError);
		});

		it('throws PermanentOperationError too_large for a 413 body-limit rejection', () => {
			let caught: unknown;
			try {
				ensureOperationOk(
					{ success: false, status: 413, error: 'Request body too large' },
					'POST /api/tasks'
				);
			} catch (e) {
				caught = e;
			}
			expect(caught).toBeInstanceOf(PermanentOperationError);
			expect((caught as PermanentOperationError).status).toBe(413);
			expect((caught as PermanentOperationError).code).toBe('too_large');
		});

		it('throws PermanentOperationError quota_exceeded for a 413 QUOTA_EXCEEDED body', () => {
			let caught: unknown;
			try {
				ensureOperationOk({ success: false, status: 413, error: 'QUOTA_EXCEEDED' }, 'POST x');
			} catch (e) {
				caught = e;
			}
			expect((caught as PermanentOperationError).code).toBe('quota_exceeded');
		});

		it('throws PermanentOperationError invalid for a 400 validation rejection', () => {
			let caught: unknown;
			try {
				ensureOperationOk({ success: false, status: 400, error: 'Bad request' }, 'PUT x');
			} catch (e) {
				caught = e;
			}
			expect(caught).toBeInstanceOf(PermanentOperationError);
			expect((caught as PermanentOperationError).code).toBe('invalid');
		});

		it('throws PermanentOperationError rejected for a 403 ownership rejection', () => {
			let caught: unknown;
			try {
				ensureOperationOk({ success: false, status: 403, error: 'Forbidden' }, 'POST x');
			} catch (e) {
				caught = e;
			}
			expect((caught as PermanentOperationError).code).toBe('rejected');
		});
	});
});
