/**
 * Cross-tab / cross-app refresh-token coordination.
 *
 * Two SvelteKit apps (reborn-task + reborn-notes) running on the same origin
 * share the httpOnly `refresh_token` cookie. If two tabs (or two apps) hit
 * `/api/auth/refresh` simultaneously with the same token, the server detects
 * the second call as "token reuse" and revokes the entire token family — the
 * user sees an unexpected session-expired banner within minutes of opening
 * both apps.
 *
 * `withRefreshLock` serializes refresh calls across every tab/app on the same
 * origin so at most one refresh runs at a time. Inside the callback the caller
 * can first consult `localStorage` for a freshly-minted access_token written
 * by the tab that held the lock previously, avoiding a redundant fetch.
 *
 * Preferred implementation: Web Locks API (`navigator.locks.request`), which
 * is designed for exactly this use case and serializes across every same-origin
 * browsing context. Fallback: localStorage-based mutex with a short timeout in
 * case the API is unavailable or restricted (very old browsers / some PWA
 * sandbox edge cases).
 */

const LOCK_NAME = 'reborn_auth_refresh';
const FALLBACK_LOCK_KEY = '__reborn_refresh_lock_v1';
const FALLBACK_STALE_MS = 10_000;
const FALLBACK_POLL_MS = 75;

type LockRunner = <T>(fn: () => Promise<T>) => Promise<T>;

function hasWebLocks(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { locks?: unknown }).locks !== 'undefined'
  );
}

const webLocksRunner: LockRunner = async <T>(fn: () => Promise<T>): Promise<T> => {
  const locks = (navigator as Navigator & {
    locks: { request: (name: string, cb: () => unknown) => Promise<unknown> };
  }).locks;
  return (await locks.request(LOCK_NAME, () => fn())) as T;
};

/**
 * localStorage-backed fallback. Not as robust as Web Locks (races still
 * possible under extreme contention) but good enough to prevent the common
 * "two apps refresh at the same time" case and auto-heals after 10s.
 */
const localStorageRunner: LockRunner = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (typeof localStorage === 'undefined') return fn();

  const ownerId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

  // Busy-wait for up to 10s, then forcibly take the lock (previous holder
  // likely crashed or left the page without releasing).
  const deadline = Date.now() + FALLBACK_STALE_MS;
  while (Date.now() < deadline) {
    const raw = localStorage.getItem(FALLBACK_LOCK_KEY);
    if (!raw) break;
    try {
      const held = JSON.parse(raw) as { owner: string; expires: number };
      if (held.expires < Date.now()) break;
      if (held.owner === ownerId) break;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, FALLBACK_POLL_MS));
  }

  localStorage.setItem(
    FALLBACK_LOCK_KEY,
    JSON.stringify({ owner: ownerId, expires: Date.now() + FALLBACK_STALE_MS })
  );

  try {
    return await fn();
  } finally {
    try {
      const raw = localStorage.getItem(FALLBACK_LOCK_KEY);
      if (raw) {
        const held = JSON.parse(raw) as { owner: string };
        if (held.owner === ownerId) localStorage.removeItem(FALLBACK_LOCK_KEY);
      }
    } catch {
      localStorage.removeItem(FALLBACK_LOCK_KEY);
    }
  }
};

/**
 * Run `fn` while holding the cross-tab refresh lock. Every caller across every
 * tab/app on this origin queues on the same lock, so at most one refresh hits
 * the server at a time.
 */
export function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const runner: LockRunner = hasWebLocks() ? webLocksRunner : localStorageRunner;
  return runner(fn);
}
