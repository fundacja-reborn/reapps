/**
 * Server synchronisation for Reborn Notes.
 *
 * Strategy: offline-first with server as the authoritative source.
 *   Pull:  On startup (when authenticated), fetch all notes/folders/tags from server
 *          and upsert into local IndexedDB. Server wins for any conflicts.
 *   Push:  After every local write, attempt a fire-and-forget API call.
 *          If the call fails (offline / error), the item keeps sync_status='pending'
 *          in IndexedDB and will be retried on the next pull sync.
 *
 * The service is intentionally simple - no dedicated queue store, no complex
 * retry logic. Multi-device sync works by pulling from server on next app load.
 */
import {
  noteStore,
  folderStore,
  tagStore,
  savedSearchStore,
  noteTagOperations,
  noteTagQueries,
  noteHistoryStore,
  initializeStorage,
  isDatabaseInitialized,
  clearAllUserData
} from '@reborn/storage';
import type {
  NoteEncrypted,
  NoteStoredLocal,
  NoteHistoryEntry,
  FolderEncrypted,
  TagEncrypted,
  SavedSearchEncrypted,
  SyncErrorCode
} from '@reborn/types';
import { cryptoManager, isEncryptedDataReadable } from '@reborn/crypto';
import { extractShadowIndexes } from './shadow-index-extractor';
import { get } from 'svelte/store';
import { API_BASE } from '$lib/utils/api-base';
import { singleFlight } from '$lib/utils/single-flight';
import { authStore } from '$lib/stores/auth.store';
import { createLogger } from '@reborn/utils';
import {
  isSyncing,
  syncError,
  lastSyncedAt,
  isInitialSync,
  syncProgress,
  refreshPendingCount
} from '$lib/stores/sync-status.store';
import { authFetch } from '$lib/utils/auth-fetch';
import { validateEncryptedPayload } from '@reborn/crypto';
import { refreshQuota } from '$lib/stores/storage-quota.store';
import { connectivityStore } from '$lib/stores/connectivity.store';
import { buildFolderLayers } from './folder-push-order';
import { planCycleRepairs } from './folder-cycle-repair';
import { settleInBatches } from './sync-batch';
import { notifyNoteSyncError, notifyBatchSyncErrors } from './sync-error-notify';
import { ensureOk, HttpPushError } from './push-error';

const logger = createLogger('Notes-Sync');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  const msg = e.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('abort')
  );
}

/**
 * Central hook for any caught sync error. Hints the connectivity store whenever
 * the failure smells like a dead network - which `navigator.onLine` would
 * otherwise miss under an active VPN tunnel.
 */
function reportSyncError(e: unknown): void {
  if (isNetworkError(e)) connectivityStore?.markFailure();
}

// Push-error classification (HttpPushError / ensureOk / isPermanentStatus) lives
// in ./push-error so it can be unit-tested without this file's browser deps.

/**
 * Mark a note as permanently rejected: it leaves the 'pending' retry set and
 * the UI surfaces it (red footer count + per-note badge). A later local edit
 * re-marks it 'pending' (rule 9), which clears the error and retries the push.
 */
async function markNoteSyncError(id: string, code: SyncErrorCode): Promise<void> {
  const current = (await noteStore.get(id)) as NoteStoredLocal | undefined;
  if (current) {
    await noteStore.save({ ...current, sync_status: 'sync_error', sync_error_code: code });
  }
}

function isAuthenticated(): boolean {
  const state = get(authStore);
  return state.isAuthenticated && !!state.userId;
}

// ── Post-pull store refresh ──────────────────────────────────────

/**
 * Rebuild in-memory indexes and refresh Svelte stores after a successful pull.
 *
 * `pullFromServer()` only writes to IndexedDB - the in-memory `noteIndex`,
 * `foldersStore`, `tagsStore`, and `notesStore` remain stale until explicitly
 * refreshed. Call this after every successful pull to propagate changes to UI.
 */
export async function refreshStoresAfterPull(): Promise<void> {
  const { noteIndex } = await import('$lib/services/note-index.svelte');
  const { foldersStore } = await import('$lib/stores/folders.store');
  const { tagsStore } = await import('$lib/stores/tags.store');
  const { savedSearchesStore } = await import('$lib/stores/saved-searches.store');
  const { notesStore } = await import('$lib/stores/notes.store');
  const { noteDetailService } = await import('$lib/services/note-detail.service.svelte');

  await Promise.all([
    foldersStore.refresh(),
    tagsStore.refresh(),
    savedSearchesStore.refresh(),
    noteIndex.rebuild()
  ]);
  notesStore.refresh();
  await noteDetailService.refreshFromStorage();
  // First-load placeholder stays up until the stores actually hold the pulled
  // data (here), not just until the pull set lastSyncedAt - otherwise the list
  // flashes the empty state in the gap. No-op on later (periodic) refreshes.
  isInitialSync.set(false);

  // Surface multi-device periodic-note duplicates (guideline 57). Fire-and-forget
  // so it never blocks the UI refresh; cheap when there are none (title-prefix
  // pre-filter, zero decryption) and only decrypts on an actual collision.
  void (async () => {
    try {
      const { detectAndNotifyPeriodicDuplicates } =
        await import('$lib/services/periodic-dedup.service');
      await detectAndNotifyPeriodicDuplicates();
    } catch (e) {
      logger.warn('Periodic duplicate scan failed', e);
    }
  })();
}

// ── Pull sync - server → IndexedDB ───────────────────────────────

// Leading+trailing single-flight for pull sync (see `singleFlight`). Several
// triggers can fire a pull at once - login (notes-auth.service), the +layout
// initial sync, the offline->online handler, and (native) the App 'resume'
// lifecycle. Without coalescing, concurrent pulls race the read-then-write tag
// reconciliation in pullNotes (getTagsForNote -> addTagToNote) against the unique
// [note_id, tag_id] index, spamming "composite uniqueness" and duplicating every
// per-note request (costly on slow native HTTP). The TRAILING half also matters:
// a caller that just pushed (handlers do `await push; await pull`) must get a pull
// that STARTED after its push, otherwise the freshly-synced row is misread as an
// orphaned edit (the sync_status==='synced' branch in pullNotes) and re-marked
// pending, churning until a later pull catches up.
const coalescedPull = singleFlight(runPullFromServer);

/**
 * Full pull sync: fetch all notes, folders, tags from server and upsert locally.
 * Should be called once after authentication / app startup.
 * Returns true if sync succeeded, false if skipped (unauthenticated / offline).
 *
 * Coalesced (leading+trailing single-flight) - see the note above.
 */
export async function pullFromServer(): Promise<boolean> {
  return coalescedPull();
}

async function runPullFromServer(): Promise<boolean> {
  if (!isAuthenticated()) return false;

  // Re-initialize storage if the connection was terminated
  // (e.g. user deleted IndexedDB in DevTools, or browser evicted the connection).
  if (!isDatabaseInitialized()) {
    try {
      await initializeStorage('notes');
    } catch (e: unknown) {
      logger.error('Cannot sync: storage re-initialization failed', e);
      syncError.set(true);
      return false;
    }
  }

  // First-ever pull (nothing synced yet): show the loading placeholder. Cleared
  // by refreshStoresAfterPull on success (once notes are in memory) or by the
  // finally below if this pull fails - never left stuck. Placed after the
  // storage-init early-return above so a failed re-init can't strand it true.
  if (get(lastSyncedAt) === null) isInitialSync.set(true);

  isSyncing.set(true);
  syncError.set(false);

  // Note: `sessionExpired` is owned by the transport layer (`authFetch` via
  // `onSessionExpired` in `apps/reborn-notes/src/lib/utils/auth-fetch.ts`).
  // Sync-service intentionally does **not** flip the flag itself - a 401 that
  // bubbles up here was already classified by authFetch as either transient
  // (refresh hit a 5xx during deploy/rebuild - banner suppressed) or definitive
  // (refresh returned 401/403 - banner already triggered). See guideline
  // 31-session-expiry-handling.md.

  let success = true;
  try {
    // NOTE: We intentionally do NOT clear local stores before pulling.
    // Each pull* helper merges by sync_version and skips items with
    // sync_status='pending' - clearing would wipe offline edits that haven't
    // been pushed yet (observed data loss in offline → online transitions).
    // Cross-user cleanup is handled by clearAllUserData() during login/logout.
    await Promise.all([
      pullFolders().catch((e) => {
        reportSyncError(e);
        logger.error('Pull folders failed:', e);
        success = false;
      }),
      pullTags().catch((e) => {
        reportSyncError(e);
        logger.error('Pull tags failed:', e);
        success = false;
      }),
      pullSavedSearches().catch((e) => {
        reportSyncError(e);
        logger.error('Pull saved searches failed:', e);
        success = false;
      })
    ]);
    // Notes after folders/tags (they reference them). pullNotes still reports the
    // ids it actually wrote (new, or server sync_version newer); the result is
    // unused here in stage 2a and kept for the paginated delta sync in 2b.
    //
    // Version history is no longer backfilled during sync. It used to pull 1
    // GET/note for every changed note, and on a cold start (every note is "new")
    // that dominated native CapacitorHttp sync time (~31s for 503 notes) - stage
    // 1 moved it to a background task, stage 2a removes it entirely. History is
    // now fetched on demand when the panel opens (note.service
    // `syncNoteVersionsFromServer`), which is the only place a user looks at it.
    // See guideline 36.
    await pullNotes().catch((e) => {
      reportSyncError(e);
      logger.error('Pull notes failed:', e);
      success = false;
    });

    if (success) {
      logger.info('Pull sync completed');
      lastSyncedAt.set(new Date().toISOString());
    } else {
      syncError.set(true);
    }
  } catch (e) {
    reportSyncError(e);
    syncError.set(true);
    success = false;
  } finally {
    isSyncing.set(false);
    // Safety net: pullNotes clears its own progress in a finally, but if it
    // threw before that (e.g. the count()/watermark read), make sure the footer
    // counter never wedges.
    syncProgress.set(null);
    // Drop the first-load placeholder if this pull failed (e.g. offline): the
    // success path leaves it for refreshStoresAfterPull to clear once the stores
    // are hydrated. No-op when it was never set (periodic pulls).
    if (!success) isInitialSync.set(false);
    void refreshPendingCount();
    void refreshQuota();
  }
  return success;
}

async function pullFolders(): Promise<void> {
  // Capture userId once at the top. Without this guard, a logout (or auth
  // store hydration race) mid-pull would let a non-null assertion on the
  // store's userId evaluate to undefined further down - silently writing
  // user_id=undefined to IDB, which then propagates to every fresh export
  // and trips the import validator for that account. See guideline 44 +
  // `idb-cleanup.service.ts`.
  const userId = get(authStore).userId;
  if (!userId) return;
  // Snapshot the already-synced ids BEFORE the request leaves. The orphan-
  // delete below may only remove items from this set: an item that turned
  // 'synced' while the pull was in flight (e.g. created and POSTed by a live
  // folder-sync import racing this pull) is absent from the server's response
  // only because that response was built before its POST landed - deleting it
  // locally would hard-drop a record the server actually has. It then
  // resurrects on a later pull, and in the gap live folder sync re-imports its
  // file as a duplicate note. An item synced before this snapshot is genuinely
  // authoritative: the server already knew it when answering, so its absence
  // means a real remote delete.
  const prePullSyncedIds = new Set(
    ((await folderStore.getAll()) as FolderEncrypted[])
      .filter((f) => f.sync_status === 'synced')
      .map((f) => f.id)
  );
  const res = await authFetch(`${API_BASE}/folders`);
  if (!res.ok) throw new Error(`GET /api/folders: ${res.status}`);
  const { data } = await res.json();

  await Promise.all(
    (
      data as Array<{
        id: string;
        parent_id: string | null;
        name_encrypted: string;
        order_index: number;
        created_at: string;
        updated_at: string;
        sync_version?: number;
      }>
    ).map(async (f) => {
      // Skip if local folder has pending changes - don't overwrite offline edits
      const localFolder = await folderStore.get(f.id);
      if (localFolder && localFolder.sync_status === 'pending') {
        logger.debug(`Skipping pull for folder ${f.id} - has pending local changes`);
        return;
      }

      // Skip if server version is not newer than local
      const serverVersion = f.sync_version ?? 1;
      if (localFolder && serverVersion <= (localFolder.sync_version ?? 0)) {
        // Reconciliation: if local ciphertext differs from server at equal sync_version,
        // a previous push silently failed and left sync_status='synced'. Re-mark pending
        // so the next pushPendingItems() sends the local edit. See guideline 36, rule 9.
        if (
          localFolder.sync_status === 'synced' &&
          (localFolder.name_encrypted !== f.name_encrypted ||
            (localFolder.parent_id ?? null) !== (f.parent_id ?? null) ||
            localFolder.order_index !== f.order_index)
        ) {
          logger.warn(`Reconciling orphaned folder edit ${f.id} - marking pending`);
          await folderStore.save({ ...localFolder, sync_status: 'pending' });
        }
        return;
      }

      const folder: FolderEncrypted = {
        id: f.id,
        user_id: userId,
        parent_id: f.parent_id ?? undefined,
        name_encrypted: f.name_encrypted,
        order_index: f.order_index,
        is_archived: false,
        sync_version: serverVersion,
        sync_status: 'synced',
        created_at: f.created_at,
        updated_at: f.updated_at
      };
      await folderStore.save(folder);
    })
  );

  // Remove local folders that no longer exist on the server (deleted on another device).
  // Only remove 'synced' items - 'pending' items were created/edited locally and not yet
  // pushed, and items that became synced mid-pull (pre-pull snapshot miss) were acked by
  // the server AFTER this response was built, so they are not orphans.
  const serverFolderIds = new Set((data as Array<{ id: string }>).map((f) => f.id));
  const allLocalFolders = (await folderStore.getAll()) as FolderEncrypted[];
  const orphanIds = new Set(
    allLocalFolders
      .filter(
        (f) =>
          f.sync_status === 'synced' && !serverFolderIds.has(f.id) && prePullSyncedIds.has(f.id)
      )
      .map((f) => f.id)
  );
  if (orphanIds.size > 0) {
    await folderStore.deleteMany([...orphanIds]);
    logger.debug(`Removed ${orphanIds.size} locally-synced folders no longer on server`);
  }

  // Repair parent_id cycles (audit 013 N2). Two devices moving A under B and
  // B under A concurrently both pass their local pre-move cycle checks, and
  // the server accepts both writes - the pulled mirror now contains a cycle
  // whose members (plus their subtrees) are unreachable from the roots and
  // silently vanish from every folder view. Reparent one member per cycle to
  // the root; see folder-cycle-repair.ts for why the pick is deterministic
  // across devices. The repair row is marked pending atomically with the
  // write (same rationale as reorderFolders) and pushed like a user move.
  const survivors = allLocalFolders.filter((f) => !orphanIds.has(f.id));
  for (const folderId of planCycleRepairs(survivors)) {
    // Re-read: the row may have changed since the getAll() above (user move
    // racing this pull) - repair the current row, not the stale snapshot.
    const row = (await folderStore.get(folderId)) as FolderEncrypted | null;
    if (!row) continue;
    logger.warn(`Folder ${folderId} is part of a parent_id cycle - reparenting to root`);
    await folderStore.save({
      ...row,
      parent_id: undefined,
      sync_status: 'pending',
      updated_at: new Date().toISOString()
    });
    pushFolderUpdate(folderId, { parent_id: null });
  }
}

async function pullTags(): Promise<void> {
  // See pullFolders() for rationale on the userId guard.
  const userId = get(authStore).userId;
  if (!userId) return;
  // Pre-request snapshot of synced ids - see pullFolders() for the rationale
  // (a tag pushed mid-pull must survive the orphan-delete sweep).
  const prePullSyncedIds = new Set(
    ((await tagStore.getAll()) as TagEncrypted[])
      .filter((t) => t.sync_status === 'synced')
      .map((t) => t.id)
  );
  const res = await authFetch(`${API_BASE}/tags`);
  if (!res.ok) throw new Error(`GET /api/tags: ${res.status}`);
  const { data } = await res.json();

  await Promise.all(
    (
      data as Array<{
        id: string;
        name_encrypted: string;
        color_encrypted?: string;
        created_at: string;
        updated_at: string;
        sync_version?: number;
      }>
    ).map(async (t) => {
      // Skip if local tag has pending changes - don't overwrite offline edits
      const localTag = await tagStore.get(t.id);
      if (localTag && localTag.sync_status === 'pending') {
        logger.debug(`Skipping pull for tag ${t.id} - has pending local changes`);
        return;
      }

      // Compare sync_version - skip if server is not newer
      const serverVersion = t.sync_version ?? 1;
      if (localTag && serverVersion <= (localTag.sync_version ?? 0)) {
        // Reconciliation: see pullFolders() for rationale.
        if (
          localTag.sync_status === 'synced' &&
          (localTag.name_encrypted !== t.name_encrypted ||
            (localTag.color_encrypted ?? null) !== (t.color_encrypted ?? null))
        ) {
          logger.warn(`Reconciling orphaned tag edit ${t.id} - marking pending`);
          await tagStore.save({ ...localTag, sync_status: 'pending' });
        }
        return;
      }

      await tagStore.save({
        id: t.id,
        user_id: userId,
        name_encrypted: t.name_encrypted,
        color_encrypted: t.color_encrypted ?? undefined,
        usage_count: localTag?.usage_count ?? 0,
        sync_version: serverVersion,
        sync_status: 'synced',
        created_at: t.created_at,
        updated_at: t.updated_at
      });
    })
  );

  // Remove local tags that no longer exist on the server (hard-deleted on another device).
  // Synced-mid-pull tags are excluded via the pre-pull snapshot - see pullFolders().
  const serverTagIds = new Set((data as Array<{ id: string }>).map((t) => t.id));
  const allLocalTags = (await tagStore.getAll()) as TagEncrypted[];
  const orphanTagIds = allLocalTags
    .filter(
      (t) => t.sync_status === 'synced' && !serverTagIds.has(t.id) && prePullSyncedIds.has(t.id)
    )
    .map((t) => t.id);
  if (orphanTagIds.length > 0) {
    await tagStore.deleteMany(orphanTagIds);
    logger.debug(`Removed ${orphanTagIds.length} locally-synced tags no longer on server`);
  }
}

async function pullSavedSearches(): Promise<void> {
  // See pullFolders() for rationale on the userId guard.
  const userId = get(authStore).userId;
  if (!userId) return;
  // Pre-request snapshot of synced ids - see pullFolders() for the rationale
  // (a saved search pushed mid-pull must survive the orphan-delete sweep).
  const prePullSyncedIds = new Set(
    ((await savedSearchStore.getAll()) as SavedSearchEncrypted[])
      .filter((s) => s.sync_status === 'synced')
      .map((s) => s.id)
  );
  const res = await authFetch(`${API_BASE}/saved-searches`);
  if (!res.ok) throw new Error(`GET /api/saved-searches: ${res.status}`);
  const { data } = await res.json();

  await Promise.all(
    (
      data as Array<{
        id: string;
        name_encrypted: string;
        query_encrypted: string;
        metadata_encrypted?: string | null;
        folder_id: string | null;
        position: number;
        created_at: string;
        updated_at: string;
        sync_version?: number;
      }>
    ).map(async (s) => {
      // Skip if local saved search has pending changes - don't overwrite offline edits
      const local = await savedSearchStore.get(s.id);
      if (local && local.sync_status === 'pending') {
        logger.debug(`Skipping pull for saved search ${s.id} - has pending local changes`);
        return;
      }

      // Compare sync_version - skip if server is not newer
      const serverVersion = s.sync_version ?? 1;
      if (local && serverVersion <= (local.sync_version ?? 0)) {
        // Reconciliation: see pullFolders() for rationale. The folder_id compare
        // also covers the server-side `onDelete: SetNull` of a parked folder,
        // which nulls the FK without bumping sync_version - the re-marked
        // pending push then converges via the 404-unpark fallback.
        if (
          local.sync_status === 'synced' &&
          (local.name_encrypted !== s.name_encrypted ||
            local.query_encrypted !== s.query_encrypted ||
            (local.metadata_encrypted ?? null) !== (s.metadata_encrypted ?? null) ||
            (local.folder_id ?? null) !== (s.folder_id ?? null) ||
            local.position !== s.position)
        ) {
          logger.warn(`Reconciling orphaned saved-search edit ${s.id} - marking pending`);
          await savedSearchStore.save({ ...local, sync_status: 'pending' });
        }
        return;
      }

      const record: SavedSearchEncrypted = {
        id: s.id,
        user_id: userId,
        name_encrypted: s.name_encrypted,
        query_encrypted: s.query_encrypted,
        metadata_encrypted: s.metadata_encrypted ?? undefined,
        folder_id: s.folder_id ?? undefined,
        position: s.position,
        sync_version: serverVersion,
        sync_status: 'synced',
        created_at: s.created_at,
        updated_at: s.updated_at
      };
      await savedSearchStore.save(record);
    })
  );

  // Remove local saved searches that no longer exist on the server (hard-deleted on another
  // device). Synced-mid-pull rows are excluded via the pre-pull snapshot - see pullFolders().
  const serverIds = new Set((data as Array<{ id: string }>).map((s) => s.id));
  const allLocal = (await savedSearchStore.getAll()) as SavedSearchEncrypted[];
  const orphanIds = allLocal
    .filter((s) => s.sync_status === 'synced' && !serverIds.has(s.id) && prePullSyncedIds.has(s.id))
    .map((s) => s.id);
  if (orphanIds.length > 0) {
    await savedSearchStore.deleteMany(orphanIds);
    logger.debug(`Removed ${orphanIds.length} locally-synced saved searches no longer on server`);
  }
}

// Page size for the paginated delta pull. A few thousand notes / 200 = a few
// dozen pages: few enough requests to keep native bridge overhead low, small
// enough that no single transfer spikes the bridge's memory. See guideline 36.
const NOTES_PAGE_SIZE = 200;

type ServerNote = {
  id: string;
  folder_id?: string;
  title_encrypted: string;
  content_encrypted: string;
  metadata_encrypted?: string;
  is_archived?: boolean;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
  sync_version?: number;
};

type ServerPage = {
  has_more: boolean;
  next_cursor: string | null;
  total?: number;
  all_ids?: string[];
};

// ── Delta-sync watermark (localStorage, per account) ─────────────
// We persist max(updated_at) seen FROM THE SERVER so the next pull fetches only
// the delta (?since). The value is a plaintext timestamp (updated_at is already
// plaintext in the server-visibility model), so localStorage is fine; it is
// keyed by userId and never leaves the device. Read is guarded by
// noteStore.count() in pullNotes: if IndexedDB was wiped but localStorage
// survived, the watermark is ignored and a full pull runs. Cleared on logout.
const WATERMARK_PREFIX = 'notes_delta_since_';
function readWatermark(userId: string): string | null {
  try {
    return localStorage.getItem(WATERMARK_PREFIX + userId);
  } catch {
    return null;
  }
}
function writeWatermark(userId: string, iso: string): void {
  try {
    localStorage.setItem(WATERMARK_PREFIX + userId, iso);
  } catch {
    /* private mode / quota - delta just degrades to a full pull next time */
  }
}
/** Drop every account's delta watermark. Called from the logout/clear path. */
export function clearNotesDeltaWatermark(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(WATERMARK_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// Variant B orphan-delete gating: request the full id set (all_ids) only on the
// first pull of this JS session, on manual sync, and on online-recovery - NOT on
// every 5-min periodic pull (those stay pure deltas). A permanent delete from
// another device then propagates on next app start / manual sync / reconnect,
// which is benign (the trash/soft-delete state propagates via the delta itself).
// This saves both the all_ids transfer and the local getAll() on idle syncs.
let reconciledThisSession = false;
export function requestFullReconcileNextPull(): void {
  reconciledThisSession = false;
}

/**
 * Paginated delta pull of notes (Filar 1). Loops keyset pages from the server,
 * writing each page in one saveMany and revealing it in the list as it lands,
 * then orphan-deletes via the authoritative all_ids and advances the watermark.
 *
 * Returns the ids whose server state advanced this pull (reported for callers /
 * future use; history is fetched on demand, not from this list).
 */
async function pullNotes(): Promise<string[]> {
  const userId = get(authStore).userId;
  if (!userId) return [];

  // Variant B: only the first session pull / manual / online-recovery reconciles.
  const reconcile = !reconciledThisSession;
  // Ignore a stale watermark when IDB holds no notes (wiped but localStorage
  // survived) - force a full pull so we don't skip unchanged notes we don't have.
  const hasLocalNotes = (await noteStore.count()) > 0;
  const since = hasLocalNotes ? readWatermark(userId) : null;

  // Pre-pull snapshot of already-synced ids - see pullFolders() for the full
  // rationale. The orphan-delete below may only remove notes that were synced
  // BEFORE the first request left: a note POSTed and acked while this pull is
  // paging (e.g. a live folder-sync import racing the pull) is missing from
  // all_ids only because that set was captured server-side ahead of its POST.
  // Sweeping it hard-deletes a note the server has; it resurrects on a later
  // delta while folder sync re-imports its file in the gap - a duplicate note.
  // Taken only when the sweep can actually fire (reconcile, or a no-watermark
  // bulk against an old server, where the empty-store snapshot is free):
  // noteStore.getAll() deserializes every content blob, which the 5-min delta
  // pulls deliberately avoid.
  let prePullSyncedIds: Set<string> | null = null;
  if (reconcile || !since) {
    prePullSyncedIds = new Set(
      ((await noteStore.getAll()) as NoteStoredLocal[])
        .filter((n) => n.sync_status === 'synced')
        .map((n) => n.id)
    );
  }

  // Dynamic imports (same rationale as refreshStoresAfterPull): avoids a
  // sync-service <-> note-index/notes-store import cycle. Cached by the bundler.
  const { noteIndex } = await import('$lib/services/note-index.svelte');
  const { notesStore } = await import('$lib/stores/notes.store');

  const changed: string[] = [];
  let cursor: string | null = null;
  let firstPage = true;
  let total = 0;
  let done = 0;
  // Authoritative full id set for orphan-delete. Stays null unless the server
  // actually returns it (new server + reconcile) - we must NEVER orphan-delete
  // from a partial delta page (that would wipe every unchanged note).
  let allIds: Set<string> | null = null;
  let maxUpdatedAt = since ?? '';

  try {
    do {
      const params = new URLSearchParams({
        include_archived: 'true',
        limit: String(NOTES_PAGE_SIZE)
      });
      // `since` only on the first request; later pages carry the keyset cursor,
      // which already sits past `since`.
      if (firstPage && since) params.set('since', since);
      if (cursor) params.set('cursor', cursor);
      if (firstPage && reconcile) params.set('reconcile', 'true');

      const res = await authFetch(`${API_BASE}/notes?${params.toString()}`);
      if (!res.ok) throw new Error(`GET /api/notes: ${res.status}`);
      const body = await res.json();
      const data = (body.data ?? []) as ServerNote[];
      const pageInfo = body.page as ServerPage | undefined;

      if (firstPage) {
        total = pageInfo?.total ?? data.length;
        if (pageInfo?.all_ids) {
          // New server + reconcile: trust the explicit full id set.
          allIds = new Set(pageInfo.all_ids);
        } else if (!pageInfo && !since) {
          // Old server (no `page`) with no `since` returns the FULL set in `data`,
          // so it is itself authoritative for orphan-delete. With a `since` we'd
          // only get a delta, so we leave allIds null and skip orphan-delete.
          allIds = new Set(data.map((n) => n.id));
        }
        syncProgress.set({ done: 0, total });
      }

      const { changed: pageChanged, maxUpdatedAt: pageMax } = await writeNotesPage(data, userId);
      changed.push(...pageChanged);
      if (pageMax > maxUpdatedAt) maxUpdatedAt = pageMax;
      done += data.length;
      syncProgress.set({ done, total: Math.max(total, done) });

      // Incremental reveal: add this page to the in-memory index by id (point
      // reads, no full rebuild) and repaint. writeNotesPage already applied the
      // page's tag deltas, so getTagsForNote sees fresh relations.
      if (pageChanged.length > 0) {
        await noteIndex.upsertFromStore(pageChanged);
        notesStore.refresh();
      }
      // Reveal progressively: drop the first-load placeholder once the first
      // page is in memory, instead of waiting for the whole (multi-page) pull.
      if (firstPage) isInitialSync.set(false);

      cursor = pageInfo?.has_more ? (pageInfo.next_cursor ?? null) : null;
      firstPage = false;
    } while (cursor);
  } finally {
    syncProgress.set(null);
  }

  // Orphan-delete ONLY from the authoritative all_ids (never from page contents:
  // a delta page holds just the changed notes). Skipped entirely when allIds is
  // null (old server, or a non-reconcile periodic pull). Intersected with the
  // pre-pull snapshot so a note that became synced mid-pull is never swept.
  if (allIds) {
    const serverIds = allIds;
    // allIds implies the snapshot was taken (reconcile or !since). If that
    // invariant ever breaks, an empty set means "delete nothing" rather than
    // re-opening the mid-pull race.
    const preSynced = prePullSyncedIds ?? new Set<string>();
    const allLocalNotes = (await noteStore.getAll()) as NoteStoredLocal[];
    const orphanNoteIds = allLocalNotes
      .filter((n) => n.sync_status === 'synced' && !serverIds.has(n.id) && preSynced.has(n.id))
      .map((n) => n.id);
    if (orphanNoteIds.length > 0) {
      await noteStore.deleteMany(orphanNoteIds);
      logger.debug(`Removed ${orphanNoteIds.length} locally-synced notes no longer on server`);
    }
  }

  // Advance the delta watermark (server-authoritative, monotonic). Next pull
  // fetches only rows updated at/after this instant.
  if (maxUpdatedAt && maxUpdatedAt !== since) writeWatermark(userId, maxUpdatedAt);
  reconciledThisSession = true;

  return changed;
}

/**
 * Decode, reconcile and persist one page of server notes in a single batched
 * write (one saveMany per page, not save()-per-note - the O(n²) refresh trap of
 * PR #353, now bounded to a page). Applies the page's note-tag deltas too.
 * Returns the ids that advanced plus the highest server updated_at in the page.
 */
async function writeNotesPage(
  data: ServerNote[],
  userId: string
): Promise<{ changed: string[]; maxUpdatedAt: string }> {
  // Highest server updated_at in this page (ISO strings sort chronologically).
  // Computed over ALL rows, including ones the sync_version guard skips below -
  // we still saw them at that timestamp, so the next ?since must cover them.
  const maxUpdatedAt = data.reduce((m, n) => (n.updated_at > m ? n.updated_at : m), '');

  // Collect all writes here and flush them in one batch below, instead of issuing
  // them per-note inside the map. Each `noteStore.save()` runs refreshItems() - a
  // full getAll() over the whole notes table (every content_encrypted blob) - so
  // firing 503 of them concurrently made first-sync memory grow ~O(n²) and
  // OOM-killed the in-process Android System WebView at ~40 s. (iOS WKWebView
  // renders out of process with a far higher ceiling, so it absorbed the same
  // spike in ~10 s.) saveMany() does one transaction + one refresh; the UI is
  // rebuilt by refreshStoresAfterPull() afterwards regardless, so the per-note
  // refresh was redundant work on top of being the memory bomb. See guideline 36.
  const notesToWrite: NoteStoredLocal[] = [];
  const tagAdds: Array<{ noteId: string; tagId: string }> = [];
  const tagRemoves: Array<{ noteId: string; tagId: string }> = [];

  const changedResults = await Promise.all(
    (
      data as Array<{
        id: string;
        folder_id?: string;
        title_encrypted: string;
        content_encrypted: string;
        metadata_encrypted?: string;
        is_archived?: boolean;
        deleted_at?: string;
        created_at: string;
        updated_at: string;
        sync_version?: number;
      }>
    ).map(async (n) => {
      // Skip if local note has unsynced local state - don't overwrite offline
      // edits. 'sync_error' is included on purpose: a note rejected as
      // too-large/invalid still holds the user's local edit, so a newer server
      // version (from another device) must not silently clobber it. The user
      // resolves it by shrinking the note, which re-marks it 'pending' and
      // re-pushes. See guideline 36, rule 14.
      const localNote = (await noteStore.get(n.id)) as NoteStoredLocal | undefined;
      if (
        localNote &&
        (localNote.sync_status === 'pending' || localNote.sync_status === 'sync_error')
      ) {
        logger.debug(`Skipping pull for note ${n.id} - has unsynced local changes`);
        return null;
      }

      // Skip if server version is not newer than local (sync_version conflict detection)
      const serverVersion = n.sync_version ?? 1;
      const serverArchived = !!n.deleted_at || !!n.is_archived;
      if (localNote && serverVersion <= (localNote.sync_version ?? 0)) {
        // Archive-state reconciliation (rule 11.e defense in depth). Even when
        // versions match, if the server says archived and we say active (or
        // vice versa), trust the server. This guards against:
        //   1. Old server deploys that didn't bump sync_version on soft-delete/restore.
        //   2. Rows where the server bumped but the client's pushNoteDelete/Restore
        //      response was dropped before we could mirror the new version locally.
        // We only adjust is_archived here - content fields stay as they are so
        // local edits aren't clobbered.
        if (localNote.sync_status === 'synced' && !!localNote.is_archived !== serverArchived) {
          logger.info(
            `Reconciling archive state for note ${n.id}: local=${localNote.is_archived} server=${serverArchived}`
          );
          notesToWrite.push({ ...localNote, is_archived: serverArchived });
        }

        // Reconciliation: see pullFolders() for rationale. Covers notes whose edits
        // never reached the server because sync_status was left at 'synced' after
        // a failed fire-and-forget push.
        if (
          localNote.sync_status === 'synced' &&
          (localNote.title_encrypted !== n.title_encrypted ||
            localNote.content_encrypted !== n.content_encrypted ||
            (localNote.metadata_encrypted ?? null) !== (n.metadata_encrypted ?? null) ||
            (localNote.folder_id ?? null) !== (n.folder_id ?? null))
        ) {
          logger.warn(`Reconciling orphaned note edit ${n.id} - marking pending`);
          notesToWrite.push({ ...localNote, sync_status: 'pending' });
        }
        return null;
      }

      // Rebuild shadow indexes from metadata_encrypted. extractShadowIndexes throws when
      // cryptoManager isn't ready or AES-GCM rejects the ciphertext - in both cases we
      // skip the save entirely instead of writing default `false/false` shadow indexes
      // with a preserved ciphertext, which would be locked-in corruption (pull-side
      // sync_version guard above would skip re-decrypt on every subsequent sync until
      // the next logout+login wipes IDB). The next successful pull will retry.
      let is_pinned: boolean;
      let is_starred: boolean;
      let metaTagIds: string[];
      try {
        const shadow = await extractShadowIndexes(n.metadata_encrypted, cryptoManager);
        is_pinned = shadow.is_pinned;
        is_starred = shadow.is_starred;
        metaTagIds = shadow.tagIds;
      } catch (err) {
        logger.warn(
          `Skipping save of note ${n.id} - shadow indexes could not be derived. Will retry on next successful sync.`,
          err
        );
        return null;
      }

      const note: NoteStoredLocal = {
        id: n.id,
        user_id: userId,
        folder_id: n.folder_id ?? undefined,
        title_encrypted: n.title_encrypted,
        content_encrypted: n.content_encrypted,
        metadata_encrypted: n.metadata_encrypted,
        is_pinned,
        is_starred,
        is_archived: serverArchived,
        sync_version: serverVersion,
        sync_status: 'synced',
        created_at: n.created_at,
        updated_at: n.updated_at
      };
      notesToWrite.push(note);

      // Rebuild local note-tag associations from metadata_encrypted. Collect the
      // deltas here (read-only) and apply them in a bounded sweep below, off the
      // per-note hot path - noteTagStore.save()/delete() each refresh that store too.
      if (metaTagIds.length > 0) {
        const currentTagIds = await noteTagQueries.getTagsForNote(n.id);
        for (const tagId of metaTagIds) {
          if (!currentTagIds.includes(tagId)) tagAdds.push({ noteId: n.id, tagId });
        }
        for (const tagId of currentTagIds) {
          if (!metaTagIds.includes(tagId)) tagRemoves.push({ noteId: n.id, tagId });
        }
      }

      // This note's server state advanced (new, or newer sync_version). Reported
      // for stage 2b's delta sync; unused now that history loads on demand.
      return n.id;
    })
  );

  // Flush every note upsert / reconciliation in a single transaction (one
  // refreshItems for the whole pull, not one per note). saveMany runs the same
  // pre-save encryption guard per record as save(); a record that fails it is
  // counted and skipped rather than aborting the whole sync.
  if (notesToWrite.length > 0) {
    const result = await noteStore.saveMany(notesToWrite);
    if (result.failed > 0) {
      logger.warn(
        `pullNotes: ${result.failed}/${notesToWrite.length} note writes failed in batch`,
        { errors: result.errors.slice(0, 3) }
      );
    }
  }

  // Apply tag-association deltas in bounded batches. addTagToNote/removeTagFromNote
  // each refresh the (small) noteTags store; settleInBatches keeps that off a
  // 503-wide burst. Disjoint pairs across notes, so global add-then-remove order
  // is safe (a note never has the same tagId queued for both add and remove).
  if (tagAdds.length > 0) {
    await settleInBatches(tagAdds, ({ noteId, tagId }) =>
      noteTagOperations
        .addTagToNote(noteId, tagId)
        .catch((e) => logger.warn('Failed to add tag to note', e))
    );
  }
  if (tagRemoves.length > 0) {
    await settleInBatches(tagRemoves, ({ noteId, tagId }) =>
      noteTagOperations
        .removeTagFromNote(noteId, tagId)
        .catch((e) => logger.warn('Failed to remove tag from note', e))
    );
  }

  return {
    changed: changedResults.filter((id): id is string => id !== null),
    maxUpdatedAt
  };
}

// ── Push helpers - IndexedDB → server ────────────────────────────

/**
 * Mark every local record (folders, tags, saved searches, notes) as pending so
 * the next push uploads it. Used when a local-only (no-account) session
 * upgrades to a real account: everything was created offline and never synced,
 * so it all has to reach the server. The records keep their existing
 * master-key ciphertext (the account adopts the same key), so no re-encryption
 * is needed - only the sync flag changes. Idempotent: rows already pending are
 * left untouched. The server assigns ownership from the JWT, so user_id is not
 * rewritten here; the next pull converges it.
 */
export async function markAllLocalDataPending(): Promise<void> {
  const [folders, tags, savedSearches, notes] = await Promise.all([
    folderStore.getAll() as Promise<FolderEncrypted[]>,
    tagStore.getAll() as Promise<TagEncrypted[]>,
    savedSearchStore.getAll() as Promise<SavedSearchEncrypted[]>,
    noteStore.getAll() as Promise<NoteStoredLocal[]>
  ]);

  const ops: Promise<unknown>[] = [];
  for (const f of folders) {
    if (f.sync_status !== 'pending') ops.push(folderStore.save({ ...f, sync_status: 'pending' }));
  }
  for (const t of tags) {
    if (t.sync_status !== 'pending') ops.push(tagStore.save({ ...t, sync_status: 'pending' }));
  }
  for (const s of savedSearches) {
    if (s.sync_status !== 'pending')
      ops.push(savedSearchStore.save({ ...s, sync_status: 'pending' }));
  }
  for (const n of notes) {
    if (n.sync_status !== 'pending') ops.push(noteStore.save({ ...n, sync_status: 'pending' }));
  }
  await Promise.all(ops);
  logger.info(`Marked ${ops.length} local records pending for account upload`);
}

// Cross-key push guard - set once the pending rows were confirmed to decrypt
// with the current master key (or a recovery wipe just emptied the DB). Never
// reset within a JS session: every same-session key switch goes through a
// login/logout flow that hard-reloads the page or clears IndexedDB first.
let pendingRowsKeyChecked = false;

/**
 * Push all locally-pending items (folders, tags, notes) to the server.
 * Called during manual sync to ensure local-only items reach the server.
 *
 * Every fan-out below goes through `settleInBatches` (cap `SYNC_BATCH_SIZE`)
 * rather than a flat `Promise.allSettled`, so a mass push (a folder import can
 * leave ~200 notes pending at once) never fires the whole burst concurrently
 * and saturates the server's shared pg pool. See `sync-batch.ts`.
 */
export async function pushPendingItems(): Promise<void> {
  if (!isAuthenticated()) return;
  // Authenticated but locked (master key not in memory - e.g. a fresh tab
  // parked on /auth/unlock when the offline→online handler fires): the
  // cross-key probe below cannot tell "wrong key" from "no key loaded",
  // decryptText rejects either way, so it would misread every pending row as
  // foreign and the online branch would wipe not-yet-pushed offline edits.
  // Without the key row ownership cannot be verified - defer the push to the
  // post-unlock sync, like the import guard does (audit 013 S1).
  if (!cryptoManager.isInitialized()) return;

  const [allFolders, allTags, allSavedSearches, allNotes] = await Promise.all([
    folderStore.getAll() as Promise<FolderEncrypted[]>,
    tagStore.getAll() as Promise<TagEncrypted[]>,
    savedSearchStore.getAll() as Promise<SavedSearchEncrypted[]>,
    noteStore.getAll() as Promise<NoteStoredLocal[]>
  ]);

  const pendingFolders = allFolders.filter((f) => f.sync_status === 'pending');
  const pendingTags = allTags.filter((t) => t.sync_status === 'pending');
  const pendingSavedSearches = allSavedSearches.filter((s) => s.sync_status === 'pending');
  // Partition notes by is_archived: non-archived pending rows are failed
  // creates/updates and go through POST /api/notes; archived pending rows are
  // failed soft-deletes and must be retried via pushNoteDelete. Before this
  // split, a retried archived note would have been POSTed like a new note,
  // resurrecting it on the server.
  //
  // is_ephemeral rows are excluded entirely: these are pristine untouched "new
  // notes" whose push is deferred until the user's first action (#349). The
  // server must never see them, so the retry sweep must skip them too - the
  // first deliberate action clears the flag and POSTs the row.
  const pendingNotes = allNotes.filter(
    (n) => n.sync_status === 'pending' && !n.is_archived && !n.is_ephemeral
  );
  const pendingArchivedNotes = allNotes.filter(
    (n) => n.sync_status === 'pending' && n.is_archived && !n.is_ephemeral
  );

  if (
    pendingFolders.length +
      pendingTags.length +
      pendingSavedSearches.length +
      pendingNotes.length +
      pendingArchivedNotes.length ===
    0
  )
    return;

  // Pending rows must decrypt with the CURRENT master key before they are
  // pushed. Notes created in local-only mode are all pending; when the user
  // then logs into an EXISTING account in the peer Task app, Task swaps the
  // shared-origin key to the account key but wipes only its own DB - Notes
  // still holds ciphertexts under the abandoned local key. Pushing them would
  // permanently attach unreadable records to the account (wrong key, valid
  // iv:ciphertext format - the Encryption Guard cannot tell). Probe one
  // ciphertext per entity kind; on a mismatch wipe local data and let the
  // caller's follow-up pull repopulate (every push site pairs push with pull).
  // Offline the push is just skipped - a wipe without a pull would destroy the
  // only copy. Mirrors Task's recoverFromKeyMismatch (audit 012 S6).
  if (!pendingRowsKeyChecked) {
    const readable = await isEncryptedDataReadable(
      [
        (pendingNotes[0] ?? pendingArchivedNotes[0])?.title_encrypted,
        pendingFolders[0]?.name_encrypted,
        pendingTags[0]?.name_encrypted,
        pendingSavedSearches[0]?.name_encrypted
      ],
      (ciphertext) => cryptoManager.decryptText(ciphertext)
    );
    if (!readable) {
      if (!navigator.onLine) {
        logger.error(
          'Pending rows do not decrypt with the current master key and we are offline - skipping push (recovery needs a pull)'
        );
        return;
      }
      logger.warn(
        'Pending rows are encrypted under a different master key - wiping local data; the follow-up pull restores the account state'
      );
      await clearAllUserData();
      // Full pull next: the delta watermark belongs to the wiped data set.
      clearNotesDeltaWatermark();
      // The in-memory index/stores still hold the stale rows - reset them so
      // the UI shows the pull result, not the just-wiped foreign-key data.
      const { noteIndex } = await import('$lib/services/note-index.svelte');
      const { notesStore } = await import('$lib/stores/notes.store');
      noteIndex.clear();
      notesStore.refresh();
      pendingRowsKeyChecked = true;
      return;
    }
    pendingRowsKeyChecked = true;
  }

  logger.info(
    `Pushing pending items: ${pendingFolders.length} folders, ${pendingTags.length} tags, ${pendingSavedSearches.length} saved searches, ${pendingNotes.length} notes, ${pendingArchivedNotes.length} archived notes`
  );

  // Push folders BFS-by-layer so parents land before children. Server's
  // POST /api/folders rejects with 404 "Parent folder not found" when
  // parent_id references a folder not yet on the server - a flat fan-out
  // would 404-spam mid-batch on vault imports with nested hierarchies.
  // Siblings within a layer push in parallel, capped by settleInBatches.
  for (const layer of buildFolderLayers(pendingFolders)) {
    await settleInBatches(layer, (f) =>
      serializePerEntity('folder', f.id, () =>
        pushSilently(async (idempotencyKey) => {
          const pushedFields = {
            name_encrypted: f.name_encrypted,
            parent_id: f.parent_id ?? null,
            order_index: f.order_index
          };
          const payload = { id: f.id, ...pushedFields, created_at: f.created_at };
          validateEncryptedPayload(payload as Record<string, unknown>);
          const res = await authFetch(`${API_BASE}/folders`, {
            method: 'POST',
            headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error(`POST /api/folders: ${res.status}`);
          const { data: resData } = await res.json();
          const current = await folderStore.get(f.id);
          if (current) {
            const stillDirty = pushedFieldsDiffer(current, pushedFields);
            await folderStore.save({
              ...current,
              sync_status: stillDirty ? 'pending' : 'synced',
              sync_version: resData?.sync_version ?? 1
            });
          }
        })
      )
    );
  }

  // Tags don't reference folders - push in parallel after folders are
  // settled. Notes' metadata_encrypted may embed tag ids, so tags must
  // land before the notes layer below.
  await settleInBatches(pendingTags, (t) =>
    serializePerEntity('tag', t.id, () =>
      pushSilently(async (idempotencyKey) => {
        const pushedFields = {
          name_encrypted: t.name_encrypted,
          color_encrypted: t.color_encrypted ?? null
        };
        const payload = { id: t.id, ...pushedFields, created_at: t.created_at };
        validateEncryptedPayload(payload as Record<string, unknown>);
        const res = await authFetch(`${API_BASE}/tags`, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`POST /api/tags: ${res.status}`);
        const { data: resData } = await res.json();
        const current = await tagStore.get(t.id);
        if (current) {
          const stillDirty = pushedFieldsDiffer(current, pushedFields);
          await tagStore.save({
            ...current,
            sync_status: stillDirty ? 'pending' : 'synced',
            sync_version: resData?.sync_version ?? 1
          });
        }
      })
    )
  );

  // Saved searches reference folders (parking FK), so they go after the
  // folder layers, like notes. No other entity depends on them.
  await settleInBatches(pendingSavedSearches, (s) =>
    serializePerEntity('savedSearch', s.id, () =>
      pushSilently((idempotencyKey) => pushSavedSearchPayload(s, idempotencyKey))
    )
  );

  // Then push notes (POST for creates/updates). A permanent rejection (4xx)
  // marks the note sync_error and drops it from the retry set; we tally those
  // and raise ONE aggregated toast after the batch (a folder import can leave
  // several oversized notes at once - per-note toasts would spam).
  let newNoteSyncErrors = 0;
  await settleInBatches(pendingNotes, (n) =>
    serializePerEntity('note', n.id, () =>
      pushSilently(
        (idempotencyKey) => pushNotePayload(n, idempotencyKey),
        async (err) => {
          await markNoteSyncError(n.id, err.code);
          newNoteSyncErrors++;
        }
      )
    )
  );
  if (newNoteSyncErrors > 0) notifyBatchSyncErrors(newNoteSyncErrors);

  // Retry archived-pending notes. For notes that exist on the server
  // (sync_version > 0) we PATCH the content first, then DELETE. Without the
  // PATCH, a row whose last update push silently failed before being archived
  // keeps a server-side ciphertext that diverges from local - pull's orphan-
  // edit reconciliation flags it forever (mark pending → push DELETE only →
  // pull still sees drift → mark pending …) and "1 pending" wedges in the UI.
  // pushNoteUpdate + pushNoteDelete are serialized per-entity, so DELETE waits
  // for PATCH to land. Notes with sync_version === 0 never reached the server,
  // so there is nothing to update or delete remotely - skip both.
  const retriableArchivedNotes = pendingArchivedNotes.filter((n) => (n.sync_version ?? 0) > 0);
  await settleInBatches(retriableArchivedNotes, async (n) => {
    pushNoteUpdate(n.id, {
      title_encrypted: n.title_encrypted,
      content_encrypted: n.content_encrypted,
      folder_id: n.folder_id ?? null,
      metadata_encrypted: n.metadata_encrypted ?? undefined
    });
    pushNoteDelete(n.id);
    // pushNoteUpdate/pushNoteDelete are fire-and-forget (void), so without a
    // join the loop would enqueue every archived note at once and the cap would
    // be a no-op. Await a trailing no-op on the same per-entity chain: it runs
    // FIFO after the queued PATCH+DELETE, so this task only settles once they
    // have - giving settleInBatches real backpressure (<= SYNC_BATCH_SIZE notes
    // mid-PATCH/DELETE at a time).
    await serializePerEntity('note', n.id, () => Promise.resolve());
  });

  // Push pending note versions
  await pushPendingVersions();

  await refreshPendingCount();
}

/** Retry a function with exponential backoff (1s, 2s, 4s). */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      // Permanent rejection (4xx that won't change on retry): short-circuit so
      // we don't waste three backoff rounds re-sending an oversized or invalid
      // payload. pushSilently turns this into a sync_error mark.
      if (error instanceof HttpPushError) throw error;
      if (attempt === maxRetries) throw error;
      const delay = initialDelay * Math.pow(2, attempt);
      logger.warn(`Push attempt ${attempt + 1} failed, retrying in ${delay}ms…`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Fire-and-forget push after a local write. Transient failures retry up to 3×
 * with exponential backoff and leave the entity 'pending' (retried on the next
 * periodic/manual sync). A permanent rejection (`HttpPushError`) skips retry and
 * invokes `onPermanentFailure` so the caller can record a per-entity sync_error
 * instead of re-pushing the doomed payload forever.
 */
async function pushSilently(
  fn: (idempotencyKey: string) => Promise<void>,
  onPermanentFailure?: (err: HttpPushError) => Promise<void>
): Promise<void> {
  if (!isAuthenticated()) return;
  const idempotencyKey = crypto.randomUUID();
  try {
    await retryWithBackoff(() => fn(idempotencyKey));
  } catch (err: unknown) {
    if (err instanceof HttpPushError) {
      logger.warn(
        `Push permanently rejected (status ${err.status}, code ${err.code}) - dropping from retry:`,
        err.message
      );
      if (onPermanentFailure) {
        try {
          await onPermanentFailure(err);
        } catch (e) {
          logger.error('onPermanentFailure handler threw', e);
        }
      }
    } else {
      reportSyncError(err);
      logger.error('Push sync failed after retries (will retry on next periodic sync):', err);
    }
  } finally {
    void refreshPendingCount();
  }
}

/**
 * Per-entity FIFO queue. All `push*` operations targeting the same
 * `(type, id)` pair are chained so they execute sequentially, preventing the
 * network from reordering create/update/delete/restore for a single entity.
 *
 * Without this, the browser can dispatch a POST /folders and a DELETE
 * /folders/{id} concurrently; if the network delivers DELETE first the folder
 * stays on the server after the POST - divergent from the empty local state.
 * The delete↔restore race for notes has the same shape.
 *
 * Different entities keep running in parallel. A chain entry clears itself
 * from the map once it's the tail, so the map doesn't grow unbounded.
 */
const entityChains = new Map<string, Promise<unknown>>();

function serializePerEntity<T>(
  type: 'note' | 'folder' | 'tag' | 'savedSearch',
  id: string,
  task: () => Promise<T>
): Promise<T> {
  const key = `${type}:${id}`;
  const prev = entityChains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  entityChains.set(
    key,
    next.finally(() => {
      if (entityChains.get(key) === next) entityChains.delete(key);
    })
  );
  return next;
}

/**
 * Return true if any key in `pushed` has a different value in `current`.
 *
 * Used by push success callbacks to detect the race where a second local edit
 * ran while the first push was in flight: naive `sync_status: 'synced'` after
 * push would clobber the second edit's 'pending' marker and strand it offline.
 * When the compare flags a change, callers must keep `sync_status: 'pending'`
 * so the next `pushPendingItems()` sends the newer edit. `undefined`/`null` are
 * treated as equal so omitted-vs-explicit-null doesn't register as a change.
 */
function pushedFieldsDiffer(current: object, pushed: Record<string, unknown>): boolean {
  const rec = current as Record<string, unknown>;
  for (const key of Object.keys(pushed)) {
    const p = pushed[key] ?? null;
    const c = rec[key] ?? null;
    if (p !== c) return true;
  }
  return false;
}

/**
 * POST one note (create-or-update upsert), shared by `pushNote` (fire-and-forget
 * after a local write) and `pushPendingItems` (retry sweep).
 *
 * A 404 here means the note's `folder_id` references a folder the server does
 * not have: the folder was deleted on another device (Prisma `SetNull`'d the
 * note server-side, so the server row now sits at folder_id=null) while this
 * client kept the dead FK locally, or a folder whose own push has not landed
 * yet. Notes were the ONE entity missing the unpark recovery that folders and
 * saved searches already have, so a note whose folder vanished wedged in
 * 'pending' re-POSTing the dead FK forever (the 404 is classified transient -
 * see push-error.ts). We unpark (folder_id → null), retry once, and mirror the
 * unparking locally so the pull-side reconcile stops re-flagging the row.
 * Mirrors `pushSavedSearchPayload`. See guideline 36.
 */
async function pushNotePayload(
  note: NoteEncrypted | NoteStoredLocal,
  idempotencyKey: string
): Promise<void> {
  const pushedFields = {
    title_encrypted: note.title_encrypted,
    content_encrypted: note.content_encrypted,
    folder_id: note.folder_id ?? null,
    metadata_encrypted: note.metadata_encrypted ?? null
  };
  const payload = {
    id: note.id,
    ...pushedFields,
    metadata_encrypted: note.metadata_encrypted ?? undefined,
    created_at: note.created_at
  };
  validateEncryptedPayload(payload as Record<string, unknown>);
  let res = await authFetch(`${API_BASE}/notes`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload)
  });
  // POST is an upsert and checks the folder BEFORE writing, so a 404 with a
  // folder_id present can only be "Folder not found" - no body sniff needed.
  let unparked = false;
  if (res.status === 404 && pushedFields.folder_id) {
    logger.warn(`Note ${note.id}: folder ${pushedFields.folder_id} gone on server - unparking`);
    unparked = true;
    pushedFields.folder_id = null;
    res = await authFetch(`${API_BASE}/notes`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...payload, folder_id: null })
    });
  }
  await ensureOk(res, 'POST /api/notes');
  const { data } = await res.json();
  const current = await noteStore.get(note.id);
  if (current) {
    // Mirror the unparking before the dirty-compare, so the compare (and the
    // next pull's reconcile) sees an empty folder on both sides instead of
    // re-flagging the row. Local rows use `undefined` for "no folder" (the wire
    // uses null); pushedFieldsDiffer treats the two as equal.
    const next = unparked ? { ...current, folder_id: undefined } : current;
    const stillDirty = pushedFieldsDiffer(next, pushedFields);
    if (stillDirty) {
      logger.debug(`Note ${note.id} changed during push - keeping sync_status=pending`);
    }
    await noteStore.save({
      ...next,
      sync_status: stillDirty ? 'pending' : 'synced',
      sync_error_code: undefined,
      sync_version: data?.sync_version ?? 1
    });
  }
}

export function pushNote(note: NoteEncrypted | NoteStoredLocal): void {
  void serializePerEntity('note', note.id, () =>
    pushSilently(
      (idempotencyKey) => pushNotePayload(note, idempotencyKey),
      async (err) => {
        await markNoteSyncError(note.id, err.code);
        notifyNoteSyncError(err.code);
      }
    )
  );
}

export function pushNoteUpdate(
  id: string,
  fields: {
    title_encrypted?: string;
    content_encrypted?: string;
    // `null` explicitly detaches the note from its folder. We cannot rely on
    // `undefined` here because JSON.stringify drops undefined values, so the
    // server-side `'folder_id' in data` check would never see the field.
    folder_id?: string | null;
    metadata_encrypted?: string;
  }
): void {
  void serializePerEntity('note', id, () =>
    pushSilently(
      async (idempotencyKey) => {
        validateEncryptedPayload(fields as Record<string, unknown>);
        let res = await authFetch(`${API_BASE}/notes/${id}`, {
          method: 'PATCH',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(fields)
        });
        // A 404 on a note PATCH is ambiguous: either the note is not on the
        // server yet (folder push ordering - throw and let the pending sweep
        // POST the full row later) or the note's target folder was deleted on
        // another device ("Folder not found" - unpark to null + retry, else the
        // dead FK re-pushes forever; the 404 is classified transient). We only
        // sniff the body when a folder_id is in play. Mirrors pushSavedSearchUpdate.
        let unparked = false;
        if (res.status === 404 && fields.folder_id) {
          let errMsg = '';
          try {
            errMsg = (await res.json())?.error ?? '';
          } catch {
            /* no body */
          }
          if (errMsg !== 'Folder not found') {
            throw new Error(`PATCH /api/notes/${id}: 404`);
          }
          logger.warn(`Note ${id}: folder ${fields.folder_id} gone on server - unparking`);
          unparked = true;
          res = await authFetch(`${API_BASE}/notes/${id}`, {
            method: 'PATCH',
            headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify({ ...fields, folder_id: null })
          });
        }
        await ensureOk(res, `PATCH /api/notes/${id}`);
        const { data } = await res.json();
        const current = await noteStore.get(id);
        if (current) {
          // Mirror the unparking on both the local row and the dirty-compare, so
          // the pull-side reconcile stops re-flagging the note. The wire retry
          // sent folder_id null; the local row uses undefined for "no folder"
          // (pushedFieldsDiffer treats null/undefined as equal).
          const effectiveFields = unparked ? { ...fields, folder_id: null } : fields;
          const base = unparked ? { ...current, folder_id: undefined } : current;
          const stillDirty = pushedFieldsDiffer(base, effectiveFields);
          if (stillDirty) {
            logger.debug(`Note ${id} changed during push - keeping sync_status=pending`);
          }
          await noteStore.save({
            ...base,
            sync_status: stillDirty ? 'pending' : 'synced',
            sync_error_code: undefined,
            sync_version: data?.sync_version ?? current.sync_version ?? 1
          });
        }
      },
      async (err) => {
        await markNoteSyncError(id, err.code);
        notifyNoteSyncError(err.code);
      }
    )
  );
}

/**
 * Push a note mutation, choosing POST-create vs. PATCH-update based on whether
 * the note has ever reached the server.
 *
 * A note created as a deferred-push ephemeral blank (#349) has no server row, so
 * its first server contact MUST be a POST - a PATCH would 404. Any deliberate
 * action (edit, rename, move, pin, star, tag) promotes it: the caller clears
 * `is_ephemeral` on the saved row and passes `wasEphemeral=true` here so the
 * full row is POSTed (carrying the just-applied change). An already-synced note
 * takes the normal partial PATCH path.
 */
export function pushNoteMutation(
  row: NoteStoredLocal,
  wasEphemeral: boolean,
  patchFields: {
    title_encrypted?: string;
    content_encrypted?: string;
    folder_id?: string | null;
    metadata_encrypted?: string;
  }
): void {
  if (wasEphemeral) {
    pushNote(row);
  } else {
    pushNoteUpdate(row.id, patchFields);
  }
}

export function pushNoteDelete(id: string, permanent = false): void {
  void serializePerEntity('note', id, () =>
    pushSilently(
      async (idempotencyKey) => {
        const path = permanent ? `/notes/${id}?permanent=true` : `/notes/${id}`;
        const res = await authFetch(`${API_BASE}${path}`, {
          method: 'DELETE',
          headers: { 'Idempotency-Key': idempotencyKey }
        });
        // ensureOk (not a bare throw) so a permanent 4xx (400/403/413) becomes an
        // HttpPushError that skips retry and marks the note sync_error below,
        // instead of looping every periodic sync forever. A bodiless cross-origin
        // DELETE used to 403 on native (CSRF origin check, now disabled); even so,
        // a doomed delete must never re-push endlessly. See guideline 36 rule 14.
        await ensureOk(res, `DELETE /api/notes/${id}`);
        if (permanent) return;

        // Server bumps sync_version on soft-delete (since rule 11.e) and returns
        // the new value. We MUST mirror it locally, otherwise the next pull sees
        // server=N+1 vs local=N and re-applies the archive state we already have
        // - harmless but churn. More importantly, future pushes would operate on
        // stale sync_version and look like conflicts.
        let serverSyncVersion: number | undefined;
        try {
          const body = await res.json();
          serverSyncVersion = body?.data?.sync_version;
        } catch {
          // Old server deploy - no body. Leave sync_version untouched.
        }

        // Intent-check: if the user restored the note while DELETE was in flight,
        // `current.is_archived` will be false. Marking 'synced' would strand the
        // local restore - chain a pushNoteRestore instead. See guideline 36 rule 11.b.
        const current = await noteStore.get(id);
        if (!current) return;
        if (current.is_archived) {
          await noteStore.save({
            ...current,
            sync_status: 'synced',
            sync_version: serverSyncVersion ?? current.sync_version
          });
        } else {
          logger.debug(`Note ${id} restored during delete push - chaining restore`);
          await noteStore.save({
            ...current,
            sync_status: 'pending',
            sync_version: serverSyncVersion ?? current.sync_version
          });
          pushNoteRestore(id);
        }
      },
      async (err) => {
        // Permanent rejection of a delete: stop re-pushing the doomed request
        // (a bare throw would leave it 'pending' and retry on every periodic
        // sync) and mark the note so its row shows the reason. No per-call toast
        // - a batch can reject many; the inline badge is the durable surface.
        await markNoteSyncError(id, err.code);
      }
    )
  );
}

export function pushNoteRestore(id: string): void {
  void serializePerEntity('note', id, () =>
    pushSilently(
      async (idempotencyKey) => {
        const res = await authFetch(`${API_BASE}/notes/${id}/restore`, {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey }
        });
        // ensureOk so a permanent 4xx stops instead of retrying forever - same
        // reasoning as pushNoteDelete. See guideline 36 rule 14.
        await ensureOk(res, `POST /api/notes/${id}/restore`);

        // Server bumps sync_version on restore (since rule 11.e) and returns it.
        // Mirror locally; fall back to preserving the current value on old deploys.
        let serverSyncVersion: number | undefined;
        try {
          const body = await res.json();
          serverSyncVersion = body?.data?.sync_version;
        } catch {
          // Old server deploy - no body.
        }

        // Intent-check: if the user re-archived the note while /restore was in
        // flight, chain a pushNoteDelete to catch up. See guideline 36 rule 11.b.
        const current = await noteStore.get(id);
        if (!current) return;
        if (!current.is_archived) {
          await noteStore.save({
            ...current,
            sync_status: 'synced',
            sync_version: serverSyncVersion ?? current.sync_version
          });
        } else {
          logger.debug(`Note ${id} re-archived during restore push - chaining delete`);
          await noteStore.save({
            ...current,
            sync_status: 'pending',
            sync_version: serverSyncVersion ?? current.sync_version
          });
          pushNoteDelete(id);
        }
      },
      async (err) => {
        // Permanent rejection of a restore: stop re-pushing and mark the note so
        // its row shows the reason (mirrors pushNoteDelete).
        await markNoteSyncError(id, err.code);
      }
    )
  );
}

export function pushFolder(
  folder: Pick<
    FolderEncrypted,
    'id' | 'name_encrypted' | 'parent_id' | 'order_index' | 'created_at'
  >
): void {
  void serializePerEntity('folder', folder.id, () =>
    pushSilently(async (idempotencyKey) => {
      const pushedFields = {
        name_encrypted: folder.name_encrypted,
        parent_id: folder.parent_id ?? null,
        order_index: folder.order_index
      };
      const payload = {
        id: folder.id,
        ...pushedFields,
        created_at: folder.created_at
      };
      validateEncryptedPayload(payload as Record<string, unknown>);
      const res = await authFetch(`${API_BASE}/folders`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`POST /api/folders: ${res.status}`);
      const { data } = await res.json();
      const current = await folderStore.get(folder.id);
      if (current) {
        const stillDirty = pushedFieldsDiffer(current, pushedFields);
        if (stillDirty) {
          logger.debug(`Folder ${folder.id} changed during push - keeping sync_status=pending`);
        }
        await folderStore.save({
          ...current,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: data?.sync_version ?? 1
        });
      }
    })
  );
}

export function pushFolderUpdate(
  id: string,
  fields: { name_encrypted?: string; parent_id?: string | null; order_index?: number }
): void {
  void serializePerEntity('folder', id, () =>
    pushSilently(async (idempotencyKey) => {
      validateEncryptedPayload(fields as Record<string, unknown>);
      const res = await authFetch(`${API_BASE}/folders/${id}`, {
        method: 'PATCH',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(fields)
      });
      if (!res.ok) throw new Error(`PATCH /api/folders/${id}: ${res.status}`);
      const { data } = await res.json();
      const current = await folderStore.get(id);
      if (current) {
        const stillDirty = pushedFieldsDiffer(current, fields);
        if (stillDirty) {
          logger.debug(`Folder ${id} changed during push - keeping sync_status=pending`);
        }
        await folderStore.save({
          ...current,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: data?.sync_version ?? current.sync_version ?? 1
        });
      }
    })
  );
}

export function pushFolderDelete(id: string): void {
  void serializePerEntity('folder', id, () =>
    pushSilently(async (idempotencyKey) => {
      const res = await authFetch(`${API_BASE}/folders/${id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      if (!res.ok) throw new Error(`DELETE /api/folders/${id}: ${res.status}`);
      // Folder is hard-deleted locally before this runs (see folder.service.ts
      // deleteFolder), so there is nothing to reconcile. We deliberately do NOT
      // resurrect the row and clobber sync_version the way the old code did -
      // that broke conflict detection on the rare in-flight re-sync path.
    })
  );
}

export function pushTag(tag: {
  id: string;
  name_encrypted: string;
  color_encrypted?: string;
  created_at: string;
}): void {
  void serializePerEntity('tag', tag.id, () =>
    pushSilently(async (idempotencyKey) => {
      const pushedFields = {
        name_encrypted: tag.name_encrypted,
        color_encrypted: tag.color_encrypted ?? null
      };
      const payload = {
        id: tag.id,
        ...pushedFields,
        created_at: tag.created_at
      };
      validateEncryptedPayload(payload as Record<string, unknown>);
      const res = await authFetch(`${API_BASE}/tags`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`POST /api/tags: ${res.status}`);
      const { data: resData } = await res.json();
      const current = await tagStore.get(tag.id);
      if (current) {
        const stillDirty = pushedFieldsDiffer(current, pushedFields);
        if (stillDirty) {
          logger.debug(`Tag ${tag.id} changed during push - keeping sync_status=pending`);
        }
        await tagStore.save({
          ...current,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: resData?.sync_version ?? 1
        });
      }
    })
  );
}

export function pushTagUpdate(
  id: string,
  fields: { name_encrypted?: string; color_encrypted?: string | null }
): void {
  void serializePerEntity('tag', id, () =>
    pushSilently(async (idempotencyKey) => {
      validateEncryptedPayload(fields as Record<string, unknown>);
      const res = await authFetch(`${API_BASE}/tags/${id}`, {
        method: 'PATCH',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(fields)
      });
      if (!res.ok) throw new Error(`PATCH /api/tags/${id}: ${res.status}`);
      const { data: resData } = await res.json();
      const current = await tagStore.get(id);
      if (current) {
        const stillDirty = pushedFieldsDiffer(current, fields);
        if (stillDirty) {
          logger.debug(`Tag ${id} changed during push - keeping sync_status=pending`);
        }
        await tagStore.save({
          ...current,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: resData?.sync_version ?? current.sync_version + 1
        });
      }
    })
  );
}

export function pushTagDelete(id: string): void {
  void serializePerEntity('tag', id, () =>
    pushSilently(async (idempotencyKey) => {
      const res = await authFetch(`${API_BASE}/tags/${id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      if (!res.ok) throw new Error(`DELETE /api/tags/${id}: ${res.status}`);
      // Tag is hard-deleted locally before this runs (see tag.service.ts
      // deleteTag), so there is nothing to reconcile. No sync_version reset -
      // that's the same bug we removed from pushFolderDelete.
    })
  );
}

// ── Saved searches push ────────────────────────────────────────────

/**
 * POST one saved search, shared by `pushSavedSearch` (fire-and-forget after a
 * local write) and `pushPendingItems` (retry sweep).
 *
 * 404 means the parked folder no longer exists on the server (deleted on
 * another device while this search was created/moved offline). The search
 * itself must not be lost over that, so we unpark (folder_id → null), retry
 * once, and mirror the unparking locally - otherwise the row would wedge in
 * 'pending' re-sending the dead FK forever.
 */
async function pushSavedSearchPayload(
  search: Pick<
    SavedSearchEncrypted,
    | 'id'
    | 'name_encrypted'
    | 'query_encrypted'
    | 'metadata_encrypted'
    | 'folder_id'
    | 'position'
    | 'created_at'
  >,
  idempotencyKey: string
): Promise<void> {
  const pushedFields = {
    name_encrypted: search.name_encrypted,
    query_encrypted: search.query_encrypted,
    metadata_encrypted: search.metadata_encrypted ?? null,
    folder_id: search.folder_id ?? null,
    position: search.position
  };
  const payload = { id: search.id, ...pushedFields, created_at: search.created_at };
  validateEncryptedPayload(payload as Record<string, unknown>);
  let res = await authFetch(`${API_BASE}/saved-searches`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload)
  });
  let unparked = false;
  if (res.status === 404 && payload.folder_id) {
    logger.warn(
      `Saved search ${search.id}: parked folder ${payload.folder_id} gone on server - unparking`
    );
    unparked = true;
    pushedFields.folder_id = null;
    res = await authFetch(`${API_BASE}/saved-searches`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...payload, folder_id: null })
    });
  }
  if (!res.ok) throw new Error(`POST /api/saved-searches: ${res.status}`);
  const { data: resData } = await res.json();
  const current = await savedSearchStore.get(search.id);
  if (current) {
    // Mirror the unparking before the dirty-compare, so the next compare sees
    // folder_id null/undefined on both sides instead of re-flagging the row.
    const { folder_id: currentFolderId, ...rest } = current;
    const next = unparked ? rest : { ...rest, folder_id: currentFolderId };
    const stillDirty = pushedFieldsDiffer(next, pushedFields);
    if (stillDirty) {
      logger.debug(`Saved search ${search.id} changed during push - keeping sync_status=pending`);
    }
    await savedSearchStore.save({
      ...next,
      sync_status: stillDirty ? 'pending' : 'synced',
      sync_version: resData?.sync_version ?? 1
    });
  }
}

export function pushSavedSearch(
  search: Pick<
    SavedSearchEncrypted,
    | 'id'
    | 'name_encrypted'
    | 'query_encrypted'
    | 'metadata_encrypted'
    | 'folder_id'
    | 'position'
    | 'created_at'
  >
): void {
  void serializePerEntity('savedSearch', search.id, () =>
    pushSilently((idempotencyKey) => pushSavedSearchPayload(search, idempotencyKey))
  );
}

export function pushSavedSearchUpdate(
  id: string,
  fields: {
    name_encrypted?: string;
    query_encrypted?: string;
    metadata_encrypted?: string;
    // `null` explicitly unparks the search from the folder tree. Cannot be
    // `undefined` - JSON.stringify drops it and the server's `'folder_id' in
    // data` check would never see the field. Same contract as note moves.
    folder_id?: string | null;
    position?: number;
  }
): void {
  void serializePerEntity('savedSearch', id, () =>
    pushSilently(async (idempotencyKey) => {
      validateEncryptedPayload(fields as Record<string, unknown>);
      let res = await authFetch(`${API_BASE}/saved-searches/${id}`, {
        method: 'PATCH',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(fields)
      });
      let unparked = false;
      if (res.status === 404 && fields.folder_id) {
        // Distinguish "parked folder gone" (unpark + retry) from "search not
        // on server yet" (throw - pushPendingItems POSTs the full row later).
        let errMsg = '';
        try {
          errMsg = (await res.json())?.error ?? '';
        } catch {
          /* no body */
        }
        if (errMsg !== 'Folder not found') {
          throw new Error(`PATCH /api/saved-searches/${id}: 404`);
        }
        logger.warn(
          `Saved search ${id}: parked folder ${fields.folder_id} gone on server - unparking`
        );
        unparked = true;
        res = await authFetch(`${API_BASE}/saved-searches/${id}`, {
          method: 'PATCH',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ ...fields, folder_id: null })
        });
      }
      if (!res.ok) throw new Error(`PATCH /api/saved-searches/${id}: ${res.status}`);
      const { data: resData } = await res.json();
      const current = await savedSearchStore.get(id);
      if (current) {
        const { folder_id: currentFolderId, ...rest } = current;
        const next = unparked ? rest : { ...rest, folder_id: currentFolderId };
        const compared = unparked ? { ...fields, folder_id: null } : fields;
        const stillDirty = pushedFieldsDiffer(next, compared);
        if (stillDirty) {
          logger.debug(`Saved search ${id} changed during push - keeping sync_status=pending`);
        }
        await savedSearchStore.save({
          ...next,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: resData?.sync_version ?? current.sync_version + 1
        });
      }
    })
  );
}

export function pushSavedSearchDelete(id: string): void {
  void serializePerEntity('savedSearch', id, () =>
    pushSilently(async (idempotencyKey) => {
      const res = await authFetch(`${API_BASE}/saved-searches/${id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      if (!res.ok) throw new Error(`DELETE /api/saved-searches/${id}: ${res.status}`);
      // Saved search is hard-deleted locally before this runs (see
      // saved-search.service.ts deleteSavedSearch) - nothing to reconcile.
    })
  );
}

// ── Note version sync ──────────────────────────────────────────────

/**
 * Push a single note version to server (fire-and-forget). Marks as synced on success.
 *
 * Serialized through the note's per-entity chain (not a bare pushSilently): the
 * versions endpoint requires the parent note to exist, so a version push must run
 * AFTER any in-flight create/update for that note. Without this it can overtake a
 * freshly-promoted note's POST /api/notes and 404 (the parent row is not there
 * yet), churning three doomed retries. A failed push leaves the local row
 * 'pending' for the next pushPendingVersions() sweep. See guideline 36.
 */
export function pushNoteVersion(entry: NoteHistoryEntry): void {
  void serializePerEntity('note', entry.note_id, () =>
    pushSilently(async (idempotencyKey) => {
      // The versions endpoint gates on `findFirst(note)` and 404s if the parent
      // note is not on the server. `sync_status` is NOT a reliable "on server"
      // signal - a never-synced note trashed via folder cascade is marked
      // 'synced' locally without ever being POSTed - so gate on sync_version > 0
      // (the same signal the archived-note retry uses). Leave the row 'pending'
      // for pushPendingVersions(), which decides push/defer/drop once the note
      // lands (or is confirmed gone). Avoids three doomed 404 retries here.
      const parent = await noteStore.get(entry.note_id);
      if (!parent || (parent.sync_version ?? 0) === 0) return;

      const res = await authFetch(`${API_BASE}/notes/${entry.note_id}/versions`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          id: entry.id,
          title_encrypted: entry.title_encrypted,
          content_encrypted: entry.content_encrypted,
          created_at: entry.created_at
        })
      });
      if (!res.ok) throw new Error(`POST /api/notes/${entry.note_id}/versions: ${res.status}`);
      // Mark as synced locally
      const current = await noteHistoryStore.get(entry.id);
      if (current) {
        await noteHistoryStore.save({ ...current, sync_status: 'synced' });
      }
    })
  );
}

/**
 * Fetch one note's server-side version history and upsert it locally in a single
 * batched write. Backs the on-demand history path (note.service
 * `syncNoteVersionsFromServer` → VersionHistorySheet): history is pulled when the
 * panel opens, not backfilled during sync. The bulk cold-start backfill this
 * replaced (1 GET/note, ~31s native for 503 notes) is gone. See guideline 36.
 */
export async function pullNoteVersionsForNote(noteId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/notes/${noteId}/versions`);
  if (!res.ok) return;
  const { data } = await res.json();
  if (!Array.isArray(data)) return;

  // One batched write per note, not save()-per-row. History rows carry
  // content_encrypted (large); saveMany keeps them on a single transaction (the
  // per-row churn OOM'd the Android WebView on the notes path, PR #353).
  const entries: NoteHistoryEntry[] = (
    data as Array<{
      id: string;
      note_id: string;
      title_encrypted: string;
      content_encrypted: string;
      created_at: string;
    }>
  ).map((v) => ({
    id: v.id,
    note_id: v.note_id,
    title_encrypted: v.title_encrypted,
    content_encrypted: v.content_encrypted,
    sync_status: 'synced',
    created_at: v.created_at
  }));
  if (entries.length > 0) await noteHistoryStore.saveMany(entries);
}

/** Push all pending (unsynced) note versions to server. */
async function pushPendingVersions(): Promise<void> {
  const allVersions = (await noteHistoryStore.getAll()) as NoteHistoryEntry[];
  const pending = allVersions.filter((v) => v.sync_status === 'pending');
  if (pending.length === 0) return;

  // A version POST 404s unless its parent note already exists on the server (the
  // endpoint gates on `findFirst(note)`). Without partitioning, a version whose
  // parent never reached the server re-POSTs every sweep forever - the same
  // doomed-retry loop the note-folder unpark fixes, but for versions (surfaced by
  // a folder cascade-delete that trashed a never-synced note: the note is
  // correctly not pushed, yet its pending version 404-looped). Partition by the
  // parent's local state, using sync_version > 0 as the "on server" signal (NOT
  // sync_status - a trashed never-synced note is marked 'synced' locally):
  //   - parent on the server (sync_version > 0) → safe to push.
  //   - parent gone entirely (`!parent`, e.g. permanently deleted) → the version
  //     is orphaned for good; drop it so it stops looping.
  //   - parent present but not yet on the server (never-synced / pending /
  //     ephemeral / trashed-never-synced) → DEFER (skip this sweep), do NOT drop.
  //     Skipping already breaks the 404 loop; dropping would lose history for a
  //     note that can still reach the server (a trashed note restored, then
  //     POSTed). When such a note is eventually removed for good, the `!parent`
  //     branch reaps its now-orphaned versions.
  const pushable: NoteHistoryEntry[] = [];
  const orphanIds: string[] = [];
  for (const v of pending) {
    const parent = await noteStore.get(v.note_id);
    if (!parent) {
      orphanIds.push(v.id);
    } else if ((parent.sync_version ?? 0) > 0) {
      pushable.push(v);
    }
    // else: parent present but not on the server yet - defer to a later sweep.
  }
  if (orphanIds.length > 0) {
    await noteHistoryStore.deleteMany(orphanIds);
    logger.debug(`Dropped ${orphanIds.length} orphaned pending versions (parent note gone)`);
  }
  if (pushable.length === 0) return;

  logger.info(`Pushing ${pushable.length} pending note versions`);
  await settleInBatches(pushable, (entry) =>
    pushSilently(async (idempotencyKey) => {
      const res = await authFetch(`${API_BASE}/notes/${entry.note_id}/versions`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          id: entry.id,
          title_encrypted: entry.title_encrypted,
          content_encrypted: entry.content_encrypted,
          created_at: entry.created_at
        })
      });
      if (!res.ok) throw new Error(`POST versions: ${res.status}`);
      const current = await noteHistoryStore.get(entry.id);
      if (current) {
        await noteHistoryStore.save({ ...current, sync_status: 'synced' });
      }
    })
  );
}
