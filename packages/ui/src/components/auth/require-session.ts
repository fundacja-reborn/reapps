import { writable, get, type Readable } from 'svelte/store';

/**
 * State of the singleton "session required" prompt. When `open`, the modal is
 * mounted in the layout and is awaiting either a successful re-auth or a
 * cancellation; `resolve` is called exactly once with the outcome.
 */
export type RequireSessionPromptState =
  | { open: false }
  | { open: true; description?: string; resolve: (ok: boolean) => void };

export const requireSessionPromptStore = writable<RequireSessionPromptState>({ open: false });

export interface RequireActiveSessionOptions {
  /** Optional override for the description shown in the re-auth modal. */
  description?: string;
}

export interface CreateRequireActiveSessionDeps {
  /** Per-app `sessionExpired` store (writable or readonly). */
  sessionExpired: Readable<boolean>;
}

/**
 * Factory that binds a per-app `sessionExpired` store to a `requireActiveSession`
 * helper. Each app calls this once (in `$lib/utils/require-active-session.ts`)
 * and re-exports the resulting function for use in entry-point components.
 *
 * Returns `true` immediately when the session is healthy or the browser is
 * offline (no point prompting for credentials we can't validate); otherwise
 * opens the singleton modal and resolves with the user's outcome.
 */
export function createRequireActiveSession({ sessionExpired }: CreateRequireActiveSessionDeps) {
  return async function requireActiveSession(
    opts: RequireActiveSessionOptions = {}
  ): Promise<boolean> {
    const expired = get(sessionExpired);
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!expired || !online) return true;

    return new Promise<boolean>((resolve) => {
      requireSessionPromptStore.set({
        open: true,
        description: opts.description,
        resolve: (ok) => {
          requireSessionPromptStore.set({ open: false });
          resolve(ok);
        }
      });
    });
  };
}
