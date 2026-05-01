/**
 * Pure helpers for the import/export pipeline. Extracted so they can be unit
 * tested without dragging in IndexedDB / cryptoManager / Svelte stores.
 *
 * - `normalizeNullToUndefined` — defensive conversion for fields that the
 *   schemas treat as optional-but-not-nullable (legacy IDB or strict
 *   third-party producers may emit `null`).
 * - `formatZodIssues` — turns a `safeParse` failure into a single human
 *   readable string with field paths included (the default
 *   `error.issues[0]?.message` is just "Invalid input" — useless for triage).
 */

export function normalizeNullToUndefined(
  raw: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  const out = { ...raw };
  for (const field of fields) {
    if (out[field] === null) {
      out[field] = undefined;
    }
  }
  return out;
}

export function formatZodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map((i) => {
      const path = i.path.join('.');
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join('; ');
}

/** Optional-but-not-nullable fields per entity type. Single source of truth so
 * the import normalizer and the export sanitizer stay in sync. */
export const FOLDER_OPTIONAL_FIELDS = [
  'parent_id',
  'metadata_encrypted',
  'device_id'
] as const;
export const NOTE_OPTIONAL_FIELDS = [
  'folder_id',
  'metadata_encrypted',
  'device_id',
  'is_archived'
] as const;
export const TAG_OPTIONAL_FIELDS = ['color_encrypted', 'device_id'] as const;
