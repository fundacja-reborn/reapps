/**
 * Native current-session identity (Faza 2 follow-up).
 *
 * On web the server learns "which session is this" from the httpOnly `session_id`
 * cookie. On native that cookie is cross-site (WebView `localhost` -> remote API)
 * and `SameSite=Lax`, so it is never delivered - the same constraint that moved
 * the refresh token into secure storage. Unlike the refresh token, `session_id`
 * is NOT a secret: it is a plaintext FK the server already stores and returns per
 * the visibility model, and every operation is still authorised by the Bearer
 * token. So it lives in localStorage, not Keychain. It lets native clients name
 * their current session for the device-info PATCH and the sessions-list highlight.
 *
 * Web stays byte-identical: `IS_NATIVE` is a build-time `false`, so every function
 * short-circuits before touching storage and the header helper returns `{}`.
 */
import { IS_NATIVE } from '$lib/utils/native-client';

/** Header carrying the native client's current session id to the server. */
export const NATIVE_SESSION_HEADER = 'x-reborn-session-id';

const SESSION_ID_KEY = 'reborn_session_id';

/** Persist the current session id after login / 2FA. No-op on web (cookie path). */
export function persistNativeSessionId(sessionId: string | undefined | null): void {
  if (!IS_NATIVE || !sessionId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SESSION_ID_KEY, sessionId);
  } catch {
    /* non-critical: only the device-info / list highlight degrade, auth is unaffected */
  }
}

/** Read the stored native session id, or null (web, or never set). */
export function readNativeSessionId(): string | null {
  if (!IS_NATIVE || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(SESSION_ID_KEY);
  } catch {
    return null;
  }
}

/** Drop the stored session id on logout. No-op on web. */
export function clearNativeSessionId(): void {
  if (!IS_NATIVE || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_ID_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Header bag attaching the native session id to a request (sessions-list GET).
 * Empty on web (and when none is stored) -> the request stays byte-identical.
 */
export function nativeSessionHeader(): Record<string, string> {
  const id = readNativeSessionId();
  return id ? { [NATIVE_SESSION_HEADER]: id } : {};
}
