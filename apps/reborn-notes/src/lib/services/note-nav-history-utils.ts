/**
 * Pure trail logic for note Back/Forward navigation - the stack + cursor math,
 * free of runes/state so it is unit-testable (mirrors the note-link-utils ↔
 * note-link-graph split). The reactive wrapper lives in
 * `note-nav-history.svelte.ts`.
 *
 * A trail is a list of visited note ids (oldest → newest) plus a cursor index
 * into it (-1 when empty). All operations are immutable: they return a new
 * trail, never mutating the input.
 */

export interface NavTrail {
  /** Visited note ids, oldest → newest. */
  readonly entries: readonly string[];
  /** Index of the current note within `entries` (-1 when empty). */
  readonly cursor: number;
}

/** Cap the trail so a long session can't grow it without bound. */
export const MAX_TRAIL = 100;

export function emptyTrail(): NavTrail {
  return { entries: [], cursor: -1 };
}

export function currentId(t: NavTrail): string | null {
  return t.entries[t.cursor] ?? null;
}

/** Id Back would land on, or null if there is nothing behind the cursor. */
export function backTargetId(t: NavTrail): string | null {
  return t.cursor > 0 ? t.entries[t.cursor - 1] : null;
}

/** Id Forward would land on, or null if the cursor is at the newest entry. */
export function forwardTargetId(t: NavTrail): string | null {
  return t.cursor < t.entries.length - 1 ? t.entries[t.cursor + 1] : null;
}

/**
 * Record a visit to `id`. Truncates any forward entries first (a new visit
 * after going Back rewrites the future, like a browser), caps the length, and
 * no-ops when `id` is already the current entry (re-opening the open note).
 */
export function recordVisit(t: NavTrail, id: string): NavTrail {
  if (t.entries[t.cursor] === id) return t;
  const kept = t.entries.slice(0, t.cursor + 1);
  kept.push(id);
  const overflow = kept.length - MAX_TRAIL;
  const entries = overflow > 0 ? kept.slice(overflow) : kept;
  return { entries, cursor: entries.length - 1 };
}

/** Move the cursor back one step (no-op at the start of the trail). */
export function stepBack(t: NavTrail): NavTrail {
  return backTargetId(t) === null ? t : { entries: t.entries, cursor: t.cursor - 1 };
}

/** Move the cursor forward one step (no-op at the newest entry). */
export function stepForward(t: NavTrail): NavTrail {
  return forwardTargetId(t) === null ? t : { entries: t.entries, cursor: t.cursor + 1 };
}

/**
 * Drop every occurrence of `id` (note permanently deleted) and shift the cursor
 * so it keeps pointing at the same logical note.
 */
export function removeFromTrail(t: NavTrail, id: string): NavTrail {
  if (!t.entries.includes(id)) return t;
  const removedUpToCursor = t.entries.slice(0, t.cursor + 1).filter((e) => e === id).length;
  const entries = t.entries.filter((e) => e !== id);
  const cursor = Math.max(-1, Math.min(t.cursor - removedUpToCursor, entries.length - 1));
  return { entries, cursor };
}
