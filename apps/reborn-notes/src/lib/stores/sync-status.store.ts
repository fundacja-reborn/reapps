import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { noteStore, folderStore, tagStore } from '@reborn/storage';

// ── Types ────────────────────────────────────────────────────────

export type SyncStatusType =
  | 'synced'
  | 'syncing'
  | 'offline'
  | 'error'
  | 'pending'
  | 'needs_sync'
  | 'session_expired';

export interface SyncStatusState {
  status: SyncStatusType;
  pendingCount: number;
  lastSyncedAt: string | null;
}

// ── Online/offline ───────────────────────────────────────────────

function createOnlineStore() {
  const { subscribe, set } = writable(browser ? navigator.onLine : true);

  if (browser) {
    window.addEventListener('online', () => {
      set(true);
      // Trigger sync when coming back online (lazy import to avoid circular deps).
      // CRITICAL: push BEFORE pull — running them in parallel risks pull reaching
      // the server before push completes, so items still 'pending' locally would
      // be re-fetched as already-synced versions and subsequent push attempts
      // would conflict.
      import('$lib/services/notes-sync.service').then(
        async ({ pullFromServer, pushPendingItems, refreshStoresAfterPull }) => {
          try {
            await pushPendingItems();
            const synced = await pullFromServer();
            if (synced) await refreshStoresAfterPull();
          } catch {
            // fire-and-forget: background sync, errors handled internally
          }
        }
      );
    });
    window.addEventListener('offline', () => set(false));
  }

  return { subscribe };
}

export const isOnline = createOnlineStore();

/** Synchronous helper to check current online status */
export function checkOnline(): boolean {
  return browser ? navigator.onLine : true;
}

// ── Sync progress (set by sync service) ─────────────────────────

export const isSyncing = writable(false);
export const syncError = writable(false);
export const sessionExpired = writable(false);
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
  [isOnline, isSyncing, syncError, sessionExpired, pendingCount, lastSyncedAt],
  ([
    $isOnline,
    $isSyncing,
    $syncError,
    $sessionExpired,
    $pendingCount,
    $lastSyncedAt
  ]): SyncStatusState => {
    let status: SyncStatusType;

    if ($sessionExpired) {
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
