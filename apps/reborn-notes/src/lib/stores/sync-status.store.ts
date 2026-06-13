import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { noteStore, folderStore, tagStore } from '@reborn/storage';
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
  | 'offline'
  | 'error'
  | 'pending'
  | 'needs_sync'
  | 'session_expired'
  | 'local_only';

export interface SyncStatusState {
  status: SyncStatusType;
  pendingCount: number;
  lastSyncedAt: string | null;
}

// ── Online/offline ───────────────────────────────────────────────

// Re-export the active-probe connectivity store under the legacy `isOnline`
// name so consumers don't need to change. `navigator.onLine` is unreliable
// with a VPN tunnel (e.g. Proton in airplane mode), so we back this with a
// real HTTP probe — see `connectivity.store.ts`.
export const isOnline = connectivityIsOnline;

/** Synchronous helper to check current online status (probe-backed). */
export const checkOnline = checkConnectivityOnline;

// When connectivity transitions offline → online, kick off a sync just like
// the old `window.addEventListener('online')` handler did. CRITICAL: push
// BEFORE pull — parallel runs let pull overwrite still-pending offline edits.
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
export const syncError = writable(false);
export const sessionExpired = writable(false);
// True in local-only / no-account mode. Set by the auth store (one-way, like
// sessionExpired) to avoid an auth.store <-> sync-status.store import cycle.
// Takes precedence over every other status: there is no server session here.
export const localOnly = writable(false);
export const lastSyncedAt = writable<string | null>(null);
export const pendingCount = writable(0);

// ── Count pending items across all stores ────────────────────────

export async function refreshPendingCount(): Promise<number> {
  try {
    const stores = [noteStore, folderStore, tagStore] as Array<{
      getAll(): Promise<Array<{ sync_status?: string }>>;
    }>;
    const allItems = await Promise.all(stores.map((s) => s.getAll()));
    const count = allItems.reduce(
      (sum: number, items: Array<{ sync_status?: string }>) =>
        sum + items.filter((i) => i.sync_status === 'pending').length,
      0
    );
    pendingCount.set(count);
    return count;
  } catch {
    return 0;
  }
}

// ── Derived unified status ───────────────────────────────────────

export const syncStatus = derived(
  [isOnline, isSyncing, syncError, sessionExpired, pendingCount, lastSyncedAt, localOnly],
  ([
    $isOnline,
    $isSyncing,
    $syncError,
    $sessionExpired,
    $pendingCount,
    $lastSyncedAt,
    $localOnly
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
    } else if ($syncError) {
      status = 'error';
    } else if ($pendingCount > 0) {
      status = 'pending';
    } else if ($lastSyncedAt === null) {
      status = 'needs_sync';
    } else {
      status = 'synced';
    }

    return { status, pendingCount: $pendingCount, lastSyncedAt: $lastSyncedAt };
  }
);

// True only during the very first pull after a fresh login (IndexedDB empty,
// `lastSyncedAt` not yet written). Used to swap empty-list placeholders for a
// reassuring loading state so users don't think their notes were lost.
export const isInitialSync = derived(
  [isSyncing, lastSyncedAt],
  ([$isSyncing, $lastSyncedAt]) => $isSyncing && $lastSyncedAt === null
);
