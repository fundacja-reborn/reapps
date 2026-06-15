import { json } from '@sveltejs/kit';
import type { createLogger } from '@reborn/utils';

type Logger = ReturnType<typeof createLogger>;

/**
 * Map a caught handler error to an HTTP JSON response.
 *
 * The default `catch` in our API handlers used to return 500 for *every*
 * throw. That masked the 413 that `@sveltejs/adapter-node` raises from
 * `request.json()` when the body exceeds `BODY_SIZE_LIMIT`: the client saw a
 * generic 500, the note kept `sync_status: 'pending'`, and the periodic push
 * retried the oversized payload forever (see guideline 36, rule 14). The
 * adapter throws a `SvelteKitError` carrying a numeric `status` and a `text`
 * (e.g. `{ status: 413, text: 'Payload Too Large' }`), so we surface client
 * errors (4xx) with their real status and only fall back to 500 for genuine
 * server faults.
 *
 * We deliberately return a generic, status-derived message rather than echoing
 * `err.text`/`err.body` - the client classifies on the status code, not the
 * string, and we don't want to leak internal error detail.
 */
export function apiErrorResponse(err: unknown, logger: Logger, context: string): Response {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Not a server fault - the request itself was rejected. Log at warn so it
      // doesn't read as an outage, but stays visible for diagnosis.
      logger.warn(`${context}: rejected request with status ${status}`);
      const error =
        status === 413
          ? 'Request body too large'
          : status === 400
            ? 'Bad request'
            : 'Request rejected';
      return json({ success: false, error }, { status });
    }
  }

  logger.error(`${context} error:`, err);
  return json({ success: false, error: 'Internal server error' }, { status: 500 });
}
