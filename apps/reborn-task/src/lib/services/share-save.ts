/**
 * "Save to my tasks" from a share view (native shells, guideline 59). Same
 * hand-over as "Save to my notes" in re/notes.
 *
 * The share view does not create the task itself: it leaves a draft here and
 * opens the start route, whose redirect (or the lock / login screen the auth
 * guard puts up on the way) ends in the app layout, which creates the task in
 * the default list once the lists are loaded and opens it. One path covers the
 * unlocked app, the local passcode, an account without its key and no account
 * at all, and the snapshot is never fetched again (a share limited to one open
 * would refuse a second fetch).
 *
 * Zero Knowledge: the draft is the decrypted snapshot, so it lives ONLY in this
 * module's memory - never localStorage / sessionStorage / IndexedDB. It is
 * one-shot, expires after PENDING_SHARE_SAVE_TTL_MS and dies with the app. The
 * task it becomes carries no trace of the share (no slug, URL, key or the
 * sender's source_id) - only what the recipient saw.
 */
import type { SharedSnapshotTaskPayload } from '@reborn/types';

export interface SharedSubtaskDraft {
  title: string;
  is_completed: boolean;
}

export interface SharedTaskDraft {
  title: string;
  /** Omitted when the snapshot has no description. */
  description?: string;
  /** ISO 8601 (the format the app stores), or null when there is none. */
  due_date: string | null;
  has_time: boolean;
  subtasks: SharedSubtaskDraft[];
}

/** How long a draft waits for an unlock before it is dropped. */
export const PENDING_SHARE_SAVE_TTL_MS = 10 * 60 * 1000;

interface PendingShareSave {
  draft: SharedTaskDraft;
  /** Account the app was on when the user tapped Save; null = none signed in. */
  account: string | null;
  at: number;
}

let pending: PendingShareSave | null = null;

/**
 * The due date as the app stores it (`toISOString()`, a date-only due date at
 * UTC midnight), or null. The payload comes from someone else's app, so a
 * value that does not parse as a date is dropped rather than saved into the
 * recipient's task, where the date views would trip over it.
 */
function normalizeDueDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * The task a snapshot becomes. Title: the label the recipient saw in the view
 * (the sender's display name, which may stand in for a sensitive original
 * title), else the original title, else `untitled`. Description: unchanged.
 * Due date and time of day: kept. The task itself starts open even when the
 * sender had completed it (a completed copy would land straight among the
 * completed tasks, out of sight), while each subtask keeps the tick the
 * recipient saw (decision 2026-11-27). Subtasks without a name are skipped
 * (the app has no nameless subtask).
 */
export function taskFromSnapshot(
  payload: Pick<
    SharedSnapshotTaskPayload,
    'title' | 'display_name' | 'description' | 'metadata' | 'subtasks'
  >,
  untitled: string
): SharedTaskDraft {
  const title = payload.display_name?.trim() || payload.title.trim() || untitled;
  const dueDate = normalizeDueDate(payload.metadata.due_date);
  const draft: SharedTaskDraft = {
    title,
    due_date: dueDate,
    has_time: dueDate !== null && payload.metadata.has_time === true,
    subtasks: payload.subtasks
      .map((subtask) => ({
        title: subtask.name.trim(),
        is_completed: subtask.metadata?.is_completed === true
      }))
      .filter((subtask) => subtask.title.length > 0)
  };
  if (payload.description && payload.description.trim()) {
    draft.description = payload.description;
  }
  return draft;
}

function copyDraft(draft: SharedTaskDraft): SharedTaskDraft {
  return {
    ...draft,
    subtasks: draft.subtasks.map((subtask) => ({ ...subtask }))
  };
}

/** Leave a draft for the app layout; replaces any earlier one. */
export function stashSharedTaskSave(
  draft: SharedTaskDraft,
  account: string | null,
  now = Date.now()
): void {
  pending = { draft: copyDraft(draft), account, at: now };
}

/**
 * Take the draft for `account` (the account the tasks just unlocked for). One
 * shot: the draft is gone after this call whatever it returns. Null when there
 * is none, it expired, or the app was on another account when Save was tapped -
 * someone else's share must not land in an account that unlocked later.
 */
export function takeSharedTaskSave(
  account: string | null,
  now = Date.now()
): SharedTaskDraft | null {
  const current = pending;
  pending = null;
  if (!current) return null;
  if (now - current.at > PENDING_SHARE_SAVE_TTL_MS) return null;
  if (current.account !== null && current.account !== account) return null;
  return current.draft;
}

/** Drop any waiting draft. */
export function clearSharedTaskSave(): void {
  pending = null;
}
