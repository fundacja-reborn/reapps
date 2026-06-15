import { describe, it, expect, vi } from 'vitest';
import { apiErrorResponse } from './api-error';

type Logger = Parameters<typeof apiErrorResponse>[1];
const fakeLogger = () =>
  ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

describe('apiErrorResponse', () => {
  it('surfaces a 413 thrown by request.json() (adapter SvelteKitError) as 413, not 500', async () => {
    const logger = fakeLogger();
    // Shape adapter-node throws when the body exceeds BODY_SIZE_LIMIT.
    const err = { status: 413, text: 'Payload Too Large' };
    const res = apiErrorResponse(err, logger, 'POST /api/notes');

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Request body too large');
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('surfaces a 400 client error as 400', async () => {
    const res = apiErrorResponse({ status: 400 }, fakeLogger(), 'POST x');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Bad request');
  });

  it('maps an unknown 4xx to its status with a generic message', async () => {
    const res = apiErrorResponse({ status: 418 }, fakeLogger(), 'POST x');
    expect(res.status).toBe(418);
    expect((await res.json()).error).toBe('Request rejected');
  });

  it('maps a generic thrown Error to 500', async () => {
    const logger = fakeLogger();
    const res = apiErrorResponse(new Error('db exploded'), logger, 'POST x');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Internal server error');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('does NOT treat a 5xx-carrying error as a client error', async () => {
    const res = apiErrorResponse({ status: 503 }, fakeLogger(), 'POST x');
    expect(res.status).toBe(500);
  });

  it('maps an error without a numeric status to 500', async () => {
    const res = apiErrorResponse({ status: 'nope' }, fakeLogger(), 'POST x');
    expect(res.status).toBe(500);
  });
});
