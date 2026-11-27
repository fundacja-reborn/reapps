/**
 * "Save to my notes" from a share view (native shells, guideline 59).
 *
 * The share view does not create the note itself: it leaves a draft here and
 * opens the notes view, which creates the note once the notes are unlocked -
 * right away, or after the lock / login screen the auth guard puts up on the
 * way. That way one path covers the unlocked app, App Lock, the local passcode,
 * an account without its key and no account at all, and the snapshot is never
 * fetched again (a share limited to one open would refuse a second fetch).
 *
 * Zero Knowledge: the draft is the decrypted snapshot, so it lives ONLY in this
 * module's memory - never localStorage / sessionStorage / IndexedDB. It is
 * one-shot, expires after PENDING_SHARE_SAVE_TTL_MS and dies with the app. The
 * note it becomes carries no trace of the share (no slug, URL, key or the
 * sender's source_id) - only the title and content the recipient saw.
 */
import type { SharedSnapshotNotePayload } from '@reborn/types';

export interface SharedNoteDraft {
  title: string;
  content: string;
}

/** How long a draft waits for an unlock before it is dropped. */
export const PENDING_SHARE_SAVE_TTL_MS = 10 * 60 * 1000;

interface PendingShareSave {
  draft: SharedNoteDraft;
  /** Account the app was on when the user tapped Save; null = none signed in. */
  account: string | null;
  at: number;
}

let pending: PendingShareSave | null = null;

/**
 * The note a snapshot becomes. Title: the label the recipient saw in the view
 * header (the sender's display name, which may stand in for a sensitive
 * original title), else the original title, else `untitled`. Content: the
 * shared Markdown unchanged.
 */
export function noteFromSnapshot(
  payload: Pick<SharedSnapshotNotePayload, 'title' | 'content' | 'display_name'>,
  untitled: string
): SharedNoteDraft {
  const title = payload.display_name?.trim() || payload.title.trim() || untitled;
  return { title, content: payload.content };
}

/** Leave a draft for the notes view; replaces any earlier one. */
export function stashSharedNoteSave(
  draft: SharedNoteDraft,
  account: string | null,
  now = Date.now()
): void {
  pending = { draft: { title: draft.title, content: draft.content }, account, at: now };
}

/**
 * Take the draft for `account` (the account the notes just unlocked for). One
 * shot: the draft is gone after this call whatever it returns. Null when there
 * is none, it expired, or the app was on another account when Save was tapped -
 * someone else's share must not land in an account that unlocked later.
 */
export function takeSharedNoteSave(
  account: string | null,
  now = Date.now()
): SharedNoteDraft | null {
  const current = pending;
  pending = null;
  if (!current) return null;
  if (now - current.at > PENDING_SHARE_SAVE_TTL_MS) return null;
  if (current.account !== null && current.account !== account) return null;
  return current.draft;
}

/** Drop any waiting draft. */
export function clearSharedNoteSave(): void {
  pending = null;
}
