import { createRequireActiveSession } from '@reborn/ui';
import { sessionExpired } from '$lib/stores/sync-status.store';

/**
 * Gate for user-initiated actions that need a live server session (share,
 * manage shares, ...). When the session is healthy or the browser is offline
 * resolves `true` immediately; otherwise opens the singleton re-auth modal
 * mounted in `+layout.svelte` and resolves with the outcome.
 *
 * See `docs/development/planning/share-dialog-session-expired-gate.md`.
 */
export const requireActiveSession = createRequireActiveSession({ sessionExpired });
