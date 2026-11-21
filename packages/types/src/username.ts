/**
 * The one rule for a NEW username, shared by the sign-up form and by the
 * server's registration schema.
 *
 * Letters, digits, `_`, `-` and dots. A dot only separates two other
 * characters: not first, not last, never two in a row. That keeps names like
 * `jane.doe` while ruling out `.`, `..` and names that differ only by a
 * leading or trailing dot.
 *
 * Sign-in does NOT apply this rule (only the length bounds), so an account
 * created before the rule existed can always sign in.
 *
 * This module is free of Zod on purpose: the sign-up form imports it without
 * pulling a schema into the page.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

/** Characters a username may contain, wherever they stand. */
const USERNAME_ALLOWED_CHARS = /^[a-zA-Z0-9._-]+$/;

/** Full shape: dot-separated runs of letters, digits, `_` and `-`. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;

export type UsernameIssue = 'required' | 'too_short' | 'too_long' | 'invalid_chars' | 'invalid_dot';

/**
 * Check a username the way registration does. Returns the first problem, or
 * `null` when the name is acceptable. The caller trims; a name with spaces
 * around it is reported as `invalid_chars`.
 */
export function checkUsername(username: string): UsernameIssue | null {
  if (!username) return 'required';
  if (username.length < USERNAME_MIN_LENGTH) return 'too_short';
  if (username.length > USERNAME_MAX_LENGTH) return 'too_long';
  if (!USERNAME_ALLOWED_CHARS.test(username)) return 'invalid_chars';
  if (!USERNAME_PATTERN.test(username)) return 'invalid_dot';
  return null;
}
