/**
 * NoteNavHistory - in-memory Back/Forward navigation stack for note visits.
 *
 * A browser-like history of opened notes: every time a note becomes the active
 * note (picked from the list or followed through an internal `note:UUID` link)
 * it is recorded; Back / Forward walk that trail. Powers the header chevrons,
 * the Alt+Arrow shortcuts, and the mobile edge-swipe / back-arrow chaining.
 *
 * This is the reactive wrapper around the pure trail logic in
 * `note-nav-history-utils.ts`. Following NoteLinkGraph, the trail itself is a
 * plain (non-reactive) value and a `_version` signal is bumped on every change
 * so reactive readers re-run; the pure logic stays unit-testable without runes.
 *
 * NB: this is NAVIGATION history (which notes you visited), distinct from the
 * per-note VERSION history (`noteHistoryOperations`, `VersionHistorySheet`,
 * `historyMode`). Hence the `Nav` in the name.
 *
 * Security / Zero-Knowledge:
 *   - RAM-only. NEVER persisted to IndexedDB/localStorage/sessionStorage and
 *     NEVER sent to the server. The trail is a list of note UUIDs (already
 *     server-visible as foreign keys) plus per-note scroll offsets - no
 *     plaintext content, no new correlation signal beyond what the server
 *     already stores. Lifecycle mirrors NoteLinkGraph: cleared on lock/logout
 *     (via `noteIndex.clear()`), pruned when a note is permanently removed.
 *   - Not persisted by design: a visit trail is session navigation state, not
 *     user data. It resets on reload, like a fresh browser tab's history.
 */
import {
  emptyTrail,
  recordVisit,
  stepBack,
  stepForward,
  removeFromTrail,
  currentId,
  backTargetId,
  forwardTargetId,
  type NavTrail
} from './note-nav-history-utils';

class NoteNavHistory {
  /** Plain (non-reactive) trail; `_version` signals changes to reactive readers. */
  private _trail: NavTrail = emptyTrail();
  /** Svelte 5 reactive version counter - consumers re-render on bump. */
  private _version = $state(0);
  /**
   * Per-note scroll offset, so Back restores the reading position. Keyed by
   * note id (not stack position) so a note revisited twice shares its
   * last-known scroll. Non-reactive - read/written imperatively on navigation.
   */
  private _scroll = new Map<string, number>();

  // ── Reads (reactive) ────────────────────────────────────────────

  get current(): string | null {
    void this._version;
    return currentId(this._trail);
  }

  get backTargetId(): string | null {
    void this._version;
    return backTargetId(this._trail);
  }

  get forwardTargetId(): string | null {
    void this._version;
    return forwardTargetId(this._trail);
  }

  get canGoBack(): boolean {
    return this.backTargetId !== null;
  }

  get canGoForward(): boolean {
    return this.forwardTargetId !== null;
  }

  // ── Navigation ──────────────────────────────────────────────────

  /** Record a visit to `id` (truncates forward entries, like a browser). */
  visit(id: string): void {
    this._trail = recordVisit(this._trail, id);
    this._version++;
  }

  /** Move the cursor back one step; returns the now-current id (or null). */
  back(): string | null {
    this._trail = stepBack(this._trail);
    this._version++;
    return this.current;
  }

  /** Move the cursor forward one step; returns the now-current id (or null). */
  forward(): string | null {
    this._trail = stepForward(this._trail);
    this._version++;
    return this.current;
  }

  // ── Scroll memory ───────────────────────────────────────────────

  saveScroll(id: string, top: number): void {
    this._scroll.set(id, top);
  }

  getScroll(id: string): number {
    return this._scroll.get(id) ?? 0;
  }

  // ── Maintenance ─────────────────────────────────────────────────

  /** Drop every entry for `id` (note permanently deleted / emptied from trash). */
  remove(id: string): void {
    this._trail = removeFromTrail(this._trail, id);
    this._scroll.delete(id);
    this._version++;
  }

  /** Wipe the whole trail (lock / logout / vault refresh). */
  clear(): void {
    this._trail = emptyTrail();
    this._scroll.clear();
    this._version++;
  }
}

export const noteNavHistory = new NoteNavHistory();
