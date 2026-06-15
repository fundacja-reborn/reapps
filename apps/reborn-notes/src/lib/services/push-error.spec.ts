import { describe, it, expect } from 'vitest';
import { ensureOk, isPermanentStatus, HttpPushError } from './push-error';

describe('push-error classification', () => {
  describe('isPermanentStatus', () => {
    it('treats 400 / 403 / 413 as permanent (payload itself is the problem)', () => {
      expect(isPermanentStatus(400)).toBe(true);
      expect(isPermanentStatus(403)).toBe(true);
      expect(isPermanentStatus(413)).toBe(true);
    });

    it('treats session / ordering / rate-limit 4xx as transient', () => {
      // 401 = session (authFetch refresh), 404 = folder not on server yet,
      // 408/429 = timeout/rate-limit. None should poison the note.
      for (const s of [401, 404, 408, 409, 425, 429]) {
        expect(isPermanentStatus(s), `status ${s}`).toBe(false);
      }
    });

    it('treats 5xx as transient', () => {
      for (const s of [500, 502, 503]) expect(isPermanentStatus(s), `status ${s}`).toBe(false);
    });
  });

  describe('ensureOk', () => {
    const jsonRes = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status });

    it('resolves for a 2xx response', async () => {
      await expect(ensureOk(jsonRes(200, { success: true }), 'POST x')).resolves.toBeUndefined();
    });

    it('throws a plain Error (retryable, NOT HttpPushError) for a transient status', async () => {
      let caught: unknown;
      try {
        await ensureOk(jsonRes(500), 'POST /api/notes');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(HttpPushError);
      expect((caught as Error).message).toBe('POST /api/notes: 500');
    });

    it('throws HttpPushError too_large for a 413 body-limit rejection', async () => {
      let caught: unknown;
      try {
        await ensureOk(jsonRes(413, { error: 'Request body too large' }), 'POST /api/notes');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpPushError);
      expect((caught as HttpPushError).status).toBe(413);
      expect((caught as HttpPushError).code).toBe('too_large');
    });

    it('throws HttpPushError quota_exceeded for a 413 QUOTA_EXCEEDED body', async () => {
      let caught: unknown;
      try {
        await ensureOk(jsonRes(413, { error: 'QUOTA_EXCEEDED', used: 1, limit: 2 }), 'POST x');
      } catch (e) {
        caught = e;
      }
      expect((caught as HttpPushError).code).toBe('quota_exceeded');
    });

    it('falls back to too_large for a 413 with an empty / non-JSON body', async () => {
      let caught: unknown;
      try {
        await ensureOk(new Response(null, { status: 413 }), 'POST x');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpPushError);
      expect((caught as HttpPushError).code).toBe('too_large');
    });

    it('throws HttpPushError invalid for a 400 validation rejection', async () => {
      let caught: unknown;
      try {
        await ensureOk(jsonRes(400, { error: 'Bad request' }), 'PATCH x');
      } catch (e) {
        caught = e;
      }
      expect((caught as HttpPushError).code).toBe('invalid');
    });

    it('throws HttpPushError rejected for a 403 ownership rejection', async () => {
      let caught: unknown;
      try {
        await ensureOk(jsonRes(403, { error: 'Forbidden' }), 'POST x');
      } catch (e) {
        caught = e;
      }
      expect((caught as HttpPushError).code).toBe('rejected');
    });
  });
});
