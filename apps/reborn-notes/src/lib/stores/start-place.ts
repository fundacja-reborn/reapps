import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';
import type { StartPage } from './device-prefs.store';

const logger = createLogger('start-place');

/**
 * Where the notes view opens (issue #511).
 *
 * A cold start opens the start page chosen for this device (Settings >
 * Behavior). A re-mount of the notes view within the same JS session - unlocking
 * App Lock after the idle timeout, a local passcode unlock, coming back from
 * Settings or from a share viewer - reopens the place the user was at instead,
 * so locking or a trip to Settings never throws them back to the start page.
 *
 * Two memories, both device-local and content-free (a section name and UUIDs):
 * - session (module RAM): the current place, kept up to date while browsing.
 *   Gone on reload / when the OS kills the app, i.e. exactly on a cold start.
 * - remembered (localStorage): the same place, written only while the start
 *   page is `last` ("where you left off"), tagged with the account id so another
 *   account on this device never opens it, dropped when another start page is
 *   chosen and on logout.
 *
 * Zero Knowledge: nothing here syncs or leaves the device. The ids are the same
 * ones IndexedDB and the server already hold in plaintext; no names, no content.
 */

/**
 * Sections a place can reopen. The rest (Trash, Search, Shares, the periodic
 * notes) reopen as All notes: Trash and Search are detours, not places to
 * resume, Shares is reached from Settings, and a periodic section is a folder
 * view whose note reopens on its own.
 */
export const PLACE_SECTIONS = ['all', 'starred', 'folders', 'tags'] as const;
export type PlaceSection = (typeof PLACE_SECTIONS)[number];

export interface ViewPlace {
  section: PlaceSection;
  /** Folders: the open folder. */
  folderId?: string;
  /** Folders: the open smart folder (a saved search pinned to the tree). */
  savedSearchId?: string;
  /** Tags: the open tag. */
  tagId?: string;
  /** The open note, in any section. */
  noteId?: string;
}

/** The notes view's live navigation state, as `+page.svelte` holds it. */
export interface ViewState {
  section: string;
  folderId: string | null | undefined;
  savedSearchId: string | null;
  tagId: string | null;
  noteId: string | null;
}

/** Ids that still exist, for {@link dropMissing}. */
export interface ExistingIds {
  folderIds: ReadonlySet<string>;
  savedSearchIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPlaceSection(value: unknown): value is PlaceSection {
  return (PLACE_SECTIONS as readonly unknown[]).includes(value);
}

/**
 * The place to remember for the current view. Only the selection that belongs
 * to the section is kept (a folder in Folders, a tag in Tags); a section that is
 * not a place (Trash, Search, ...) becomes All notes, keeping the open note.
 */
export function placeFromView(view: ViewState): ViewPlace {
  const place: ViewPlace = { section: isPlaceSection(view.section) ? view.section : 'all' };
  if (place.section === 'folders') {
    if (typeof view.folderId === 'string') place.folderId = view.folderId;
    else if (view.savedSearchId) place.savedSearchId = view.savedSearchId;
  } else if (place.section === 'tags' && view.tagId) {
    place.tagId = view.tagId;
  }
  if (view.noteId) place.noteId = view.noteId;
  return place;
}

/**
 * Where the notes view opens: the session place on a re-mount, otherwise the
 * start page (`last` = the remembered place, All notes when there is none).
 */
export function initialPlace(
  startPage: StartPage,
  session: ViewPlace | null,
  remembered: ViewPlace | null
): ViewPlace {
  if (session) return session;
  if (startPage === 'last') return remembered ?? { section: 'all' };
  return { section: startPage };
}

/**
 * Drops a folder / smart folder / tag that no longer exists (deleted, or synced
 * away), so the section opens at its root instead. The note is checked against
 * IndexedDB by the caller (the note index may still be rebuilding after an
 * unlock).
 */
export function dropMissing(place: ViewPlace, existing: ExistingIds): ViewPlace {
  const next: ViewPlace = { section: place.section };
  if (place.folderId && existing.folderIds.has(place.folderId)) next.folderId = place.folderId;
  if (place.savedSearchId && existing.savedSearchIds.has(place.savedSearchId)) {
    next.savedSearchId = place.savedSearchId;
  }
  if (place.tagId && existing.tagIds.has(place.tagId)) next.tagId = place.tagId;
  if (place.noteId) next.noteId = place.noteId;
  return next;
}

/**
 * Phone: the section that is the root of the app's back navigation. All notes,
 * unless the start page is Folders or Tags - then their tree / list is the home
 * screen: no back arrow, and back from it leaves the app (Android) like it does
 * from All notes today. With any other start page (including `last`) Folders
 * and Tags stay a step down from All notes.
 */
export function mobileHomeSection(startPage: StartPage): 'all' | 'folders' | 'tags' {
  return startPage === 'folders' || startPage === 'tags' ? startPage : 'all';
}

// ── Session place (RAM) ─────────────────────────────────────────

let sessionPlace: { place: ViewPlace; account: string } | null = null;

/**
 * The place the notes view was at earlier in this session, or null on a cold
 * start. Tied to the account: signing in from local mode keeps the JS session,
 * and the local place must not carry over into the account.
 */
export function getSessionPlace(account: string | null): ViewPlace | null {
  if (!sessionPlace || !account || sessionPlace.account !== account) return null;
  return sessionPlace.place;
}

export function setSessionPlace(place: ViewPlace, account: string): void {
  sessionPlace = { place, account };
}

/**
 * Forget the session place, so the next mount opens the start page. Called when
 * a different start page is chosen: back from Settings it opens right away, the
 * feedback that the choice took effect. (Choosing "where you left off" keeps it -
 * the place the user was at IS where they left off.)
 */
export function clearSessionPlace(): void {
  sessionPlace = null;
}

// ── Remembered place (localStorage, start page `last` only) ────

const STORAGE_KEY = 'reborn-notes-last-place';

/**
 * Parses a stored place. Anything malformed, from an older format, or from
 * another account on this device reads as "nothing remembered".
 */
export function parseRememberedPlace(raw: string | null, account: string | null): ViewPlace | null {
  if (!raw || !account) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (p.v !== 1 || p.account !== account || !isPlaceSection(p.section)) return null;
  const place: ViewPlace = { section: p.section };
  if (place.section === 'folders') {
    if (isUuid(p.folderId)) place.folderId = p.folderId;
    else if (isUuid(p.savedSearchId)) place.savedSearchId = p.savedSearchId;
  } else if (place.section === 'tags' && isUuid(p.tagId)) {
    place.tagId = p.tagId;
  }
  if (isUuid(p.noteId)) place.noteId = p.noteId;
  return place;
}

/** The place remembered for `account` on this device, or null. */
export function readRememberedPlace(account: string | null): ViewPlace | null {
  if (!browser) return null;
  try {
    return parseRememberedPlace(localStorage.getItem(STORAGE_KEY), account);
  } catch (err) {
    logger.warn('Failed to read the remembered place', err);
    return null;
  }
}

export function rememberPlace(place: ViewPlace, account: string): void {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, account, ...place }));
  } catch (err) {
    // Quota / private mode - the next start just opens All notes.
    logger.warn('Failed to remember the place', err);
  }
}

/** Removes the remembered place (another start page chosen, logout). */
export function forgetRememberedPlace(): void {
  if (!browser) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable - nothing was written either.
  }
}
