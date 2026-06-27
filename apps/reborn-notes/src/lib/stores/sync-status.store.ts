import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { noteStore, folderStore, tagStore } from '@reborn/storage';
import type { SyncErrorCode } from '@reborn/types';
import {
  connectivity,
  connectivityStore,
  isOnline as connectivityIsOnline,
  checkOnline as checkConnectivityOnline
} from './connectivity.store';

// ── Types ────────────────────────────────────────────────────────

export type SyncStatusType =
  | 'synced'
  | 'syncing'
  // Notes are in IndexedDB and on screen; only the non-critical version-history
  // backfill is still running in the background (a cold start does 1 GET/note).
  // A distinct phase so the footer reads "Syncing history…" rather than a
  // blocking "Syncing…" or a premature "Synced". See notes-sync.service.
  | 'syncing_history'
  | 'offline'
  | 'error'
  // One or more records were permanently rejected by the server (a 4xx the
  // client can't fix by retrying) and dropped from the retry set. Distinct from
  // transient 'error': this needs user action (e.g. shrink an oversized note).
  | 'sync_error'
  | 'pending'
  | 'needs_sync'
  | 'session_expired'
  | 'local_only';

export interface SyncStatusState {
  status: SyncStatusType;
  pendingCount: number;
  errorCount: number;
  lastSyncedAt: string | null;
}

// ── Online/offline ───────────────────────────────────────────────

// Re-export the active-probe connectivity store under the legacy `isOnline`
// name so consumers don't need to change. `navigator.onLine` is unreliable
// with a VPN tunnel (e.g. Proton in airplane mode), so we back this with a
// real HTTP probe - see `connectivity.store.ts`.
export const isOnline = connectivityIsOnline;

/** Synchronous helper to check current online status (probe-backed). */
export const checkOnline = checkConnectivityOnline;

// When connectivity transitions offline → online, kick off a sync just like
// the old `window.addEventListener('online')` handler did. CRITICAL: push
// BEFORE pull - parallel runs let pull overwrite still-pending offline edits.
if (browser && connectivityStore) {
  let wasOnline = connectivityStore.getState().status === 'online';
  connectivity.subscribe(($c) => {
    const nowOnline = $c.status === 'online';
    if (nowOnline && !wasOnline) {
      import('$lib/services/notes-sync.service').then(
        async ({ pullFromServer, pushPendingItems, refreshStoresAfterPull }) => {
          try {
            await pushPendingItems();
            const synced = await pullFromServer();
            if (synced) await refreshStoresAfterPull();
          } catch {
            // fire-and-forget
          }
        }
      );
    }
    wasOnline = nowOnline;
  });
}

// ── Sync progress (set by sync service) ─────────────────────────

export const isSyncing = writable(false);
// Background, non-critical phase: the notes are already pulled and visible, but
// the version-history backfill (1 GET/note on a cold start - the dominant native
// sync cost) is still running. Kept separate from `isSyncing` so it never gates
// showing the notes; surfaced as the 'syncing_history' status. Ref-counted in
// notes-sync.service (overlapping pulls), so it only clears when the LAST
// backfill finishes.
export const isSyncingHistory = writable(false);
export const syncError = writable(false);
export const sessionExpired = writable(false);
// True in local-only / no-account mode. Set by the auth store (one-way, like
// sessionExpired) to avoid an auth.store <-> sync-status.store import cycle.
// Takes precedence over every other status: there is no server session here.
export const localOnly = writable(false);
export const lastSyncedAt = writable<string | null>(null);
export const pendingCount = writable(0);
// Records permanently rejected by the server (sync_status: 'sync_error').
// Tracked separately from pendingCount because these will NOT retry on the next
// periodic sync - they wait for the user to edit the record (which re-marks it
// 'pending'). Currently only notes produce this state.
export const errorCount = writable(0);
// Per-note rejection reason, keyed by note id. Drives the per-note badge in the
// list without threading sync_status through the (decrypted) note index: it is
// rebuilt from IndexedDB on every refreshPendingCount(), which already runs
// after each push/pull.
export const syncErrorMap = writable<Map<string, SyncErrorCode>>(new Map());

// ── Count pending / errored items across all stores ──────────────

/** Content equality for the per-note error map (sizes first, then entries). */
function sameErrorCodes(
  a: Map<string, SyncErrorCode>,
  b: Map<string, SyncErrorCode>
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, code] of a) {
    if (b.get(id) !== code) return false;
  }
  return true;
}

export async function refreshPendingCount(): Promise<number> {
  try {
    const stores = [noteStore, folderStore, tagStore] as Array<{
      getAll(): Promise<Array<{ id: string; sync_status?: string; sync_error_code?: SyncErrorCode }>>;
    }>;
    const allItems = await Promise.all(stores.map((s) => s.getAll()));
    let pending = 0;
    const errors = new Map<string, SyncErrorCode>();
    for (const items of allItems) {
      for (const i of items) {
        if (i.sync_status === 'pending') pending++;
        else if (i.sync_status === 'sync_error') errors.set(i.id, i.sync_error_code ?? 'rejected');
      }
    }
    pendingCount.set(pending);
    errorCount.set(errors.size);
    // syncErrorMap is read by a $derived in every visible NoteListItem. A
    // writable re-emits on every object set (new ref !== old), so publishing it
    // unconditionally would recompute every row's badge on each sync even when
    // nothing changed - wasted work, and it widens the window for Svelte's
    // benign `derived_inert` warning on a row that is mid-teardown. Publish only
    // when the error set actually changed.
    if (!sameErrorCodes(get(syncErrorMap), errors)) syncErrorMap.set(errors);
    return pending;
  } catch {
    return 0;
  }
}

// ── Derived unified status ───────────────────────────────────────

export const syncStatus = derived(
  [
    isOnline,
    isSyncing,
    syncError,
    sessionExpired,
    pendingCount,
    errorCount,
    lastSyncedAt,
    localOnly,
    isSyncingHistory
  ],
  ([
    $isOnline,
    $isSyncing,
    $syncError,
    $sessionExpired,
    $pendingCount,
    $errorCount,
    $lastSyncedAt,
    $localOnly,
    $isSyncingHistory
  ]): SyncStatusState => {
    let status: SyncStatusType;

    if ($localOnly) {
      // No account, no server: sync never runs, so this overrides everything.
      status = 'local_only';
    } else if ($sessionExpired) {
      status = 'session_expired';
    } else if (!$isOnline) {
      status = 'offline';
    } else if ($isSyncing) {
      status = 'syncing';
    } else if ($errorCount > 0) {
      // Permanent rejections need user action (shrink/fix the record), so they
      // outrank a transient sync error and the pending count.
      status = 'sync_error';
    } else if ($syncError) {
      status = 'error';
    } else if ($pendingCount > 0) {
      status = 'pending';
    } else if ($isSyncingHistory) {
      // Notes are done and visible; only the background history backfill remains.
      // Ranks below pending/error (those need user attention) but above the
      // settled states so the footer keeps signalling the backfill is working.
      status = 'syncing_history';
    } else if ($lastSyncedAt === null) {
      status = 'needs_sync';
    } else {
      status = 'synced';
    }

    return {
      status,
      pendingCount: $pendingCount,
      errorCount: $errorCount,
      lastSyncedAt: $lastSyncedAt
    };
  }
);

// Shows the "syncing your notes" placeholder in the empty main area during the
// FIRST load (IndexedDB empty after a fresh login), so users don't think their
// notes were lost. A plain writable, NOT a derived on `isSyncing && lastSyncedAt
// === null`: that derived flipped false the instant the pull wrote `lastSyncedAt`
// - i.e. BEFORE refreshStoresAfterPull repopulated the in-memory stores - so the
// list flashed the empty "no notes" state for a beat between "pull done" and
// "notes rendered". Lifecycle (notes-sync.service): runPullFromServer sets it
// true at the start of a first-ever pull and clears it if that pull fails;
// refreshStoresAfterPull clears it once the stores actually hold the pulled
// data. A local -> account login sets it true up-front (notes-auth.service) to
// also cover the pre-pull window.
export const isInitialSync = writable(false);
