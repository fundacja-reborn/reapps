/**
 * The archive marker shared by note and folder metadata bundles.
 *
 * Archiving sets `archived_at` (ISO timestamp) inside the item's
 * `metadata_encrypted` bundle; restoring removes it. Nothing is moved, so an
 * archived item keeps its folder and comes back in place.
 *
 * Zero Knowledge: the marker exists only inside the padded ciphertext. Both
 * codecs size their padding as if the marker were always present (see
 * `ARCHIVED_AT_SIZING`), so archiving or restoring never changes the
 * ciphertext length - to the server it is one more metadata update, like
 * starring a note.
 *
 * Not the trash: the trash is the plain `is_archived` flag on notes (a
 * historical wire name). The two are independent - a trashed note keeps its
 * archive marker and returns to the archive when restored from the trash.
 */

/** Cap for a stored marker, mirrored by the Zod schemas in @reborn/types. */
export const ARCHIVED_AT_MAX_LENGTH = 40;

/**
 * Stand-in the codecs use when sizing a bundle that has no marker: the length
 * of `Date.prototype.toISOString()` output (always 24 characters).
 */
export const ARCHIVED_AT_SIZING = 'x'.repeat(24);

/** A fresh marker for "archived now". */
export function newArchivedAt(): string {
  return new Date().toISOString();
}

/**
 * The marker a UI may act on: a parseable timestamp within the cap. Anything
 * else (wrong type, garbage, an over-long string) reads as "not archived" -
 * the safe direction, the item stays visible.
 */
export function readArchivedAt(bundle: { archived_at?: unknown } | null | undefined): string | undefined {
  const value = bundle?.archived_at;
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > ARCHIVED_AT_MAX_LENGTH) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * Apply an archive change to a decoded bundle: a timestamp sets the marker,
 * `undefined` removes it. Every other field, including unknown ones written
 * by a newer app version, is kept.
 */
export function withArchivedAt<T extends { archived_at?: string }>(
  bundle: T,
  archivedAt: string | undefined
): T {
  const next: T = { ...bundle };
  if (archivedAt === undefined) delete next.archived_at;
  else next.archived_at = archivedAt;
  return next;
}
