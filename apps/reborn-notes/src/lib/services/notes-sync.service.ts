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
  noteTagOperations,
  noteTagQueries,
  noteHistoryStore,
  initializeStorage,
  isDatabaseInitialized
} from '@reborn/storage';
import type {
  NoteEncrypted,
  NoteStoredLocal,
  NoteHistoryEntry,
  FolderEncrypted,
  TagEncrypted
} from '@reborn/types';
import { cryptoManager } from '@reborn/crypto';
import { extractShadowIndexes } from './shadow-index-extractor';
import { get } from 'svelte/store';
import { PUBLIC_BASE_PATH } from '$env/static/public';
import { authStore } from '$lib/stores/auth.store';
import { createLogger } from '@reborn/utils';
import {
  isSyncing,
  syncError,
  lastSyncedAt,
  refreshPendingCount
} from '$lib/stores/sync-status.store';
import { authFetch } from '$lib/utils/auth-fetch';
import { validateEncryptedPayload } from '@reborn/crypto';
import { refreshQuota } from '$lib/stores/storage-quota.store';
import { connectivityStore } from '$lib/stores/connectivity.store';
import { buildFolderLayers } from './folder-push-order';

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
  const { notesStore } = await import('$lib/stores/notes.store');
  const { noteDetailService } = await import('$lib/services/note-detail.service.svelte');

  await Promise.all([foldersStore.refresh(), tagsStore.refresh(), noteIndex.rebuild()]);
  notesStore.refresh();
  await noteDetailService.refreshFromStorage();
}

// ── Pull sync - server → IndexedDB ───────────────────────────────

/**
 * Full pull sync: fetch all notes, folders, tags from server and upsert locally.
 * Should be called once after authentication / app startup.
 * Returns true if sync succeeded, false if skipped (unauthenticated / offline).
 */
export async function pullFromServer(): Promise<boolean> {
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
      })
    ]);
    // Notes after folders/tags (they reference them)
    await pullNotes().catch((e) => {
      reportSyncError(e);
      logger.error('Pull notes failed:', e);
      success = false;
    });

    // Pull note versions after notes
    const allNotes = (await noteStore.getAll()) as NoteEncrypted[];
    const noteIds = allNotes.map((n) => n.id);
    await pullNoteVersions(noteIds).catch((e) => {
      reportSyncError(e);
      logger.error('Pull note versions failed:', e);
      // Non-critical - don't set success=false
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
  const res = await authFetch(`${PUBLIC_BASE_PATH}/api/folders`);
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
  // Only remove 'synced' items - 'pending' items were created/edited locally and not yet pushed.
  const serverFolderIds = new Set((data as Array<{ id: string }>).map((f) => f.id));
  const allLocalFolders = (await folderStore.getAll()) as FolderEncrypted[];
  const orphanIds = allLocalFolders
    .filter((f) => f.sync_status === 'synced' && !serverFolderIds.has(f.id))
    .map((f) => f.id);
  if (orphanIds.length > 0) {
    await folderStore.deleteMany(orphanIds);
    logger.debug(`Removed ${orphanIds.length} locally-synced folders no longer on server`);
  }
}

async function pullTags(): Promise<void> {
  // See pullFolders() for rationale on the userId guard.
  const userId = get(authStore).userId;
  if (!userId) return;
  const res = await authFetch(`${PUBLIC_BASE_PATH}/api/tags`);
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
  const serverTagIds = new Set((data as Array<{ id: string }>).map((t) => t.id));
  const allLocalTags = (await tagStore.getAll()) as TagEncrypted[];
  const orphanTagIds = allLocalTags
    .filter((t) => t.sync_status === 'synced' && !serverTagIds.has(t.id))
    .map((t) => t.id);
  if (orphanTagIds.length > 0) {
    await tagStore.deleteMany(orphanTagIds);
    logger.debug(`Removed ${orphanTagIds.length} locally-synced tags no longer on server`);
  }
}

async function pullNotes(): Promise<void> {
  // See pullFolders() for rationale on the userId guard.
  const userId = get(authStore).userId;
  if (!userId) return;
  const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes?include_archived=true`);
  if (!res.ok) throw new Error(`GET /api/notes: ${res.status}`);
  const { data } = await res.json();

  await Promise.all(
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
      // Skip if local note has pending changes - don't overwrite offline edits
      const localNote = (await noteStore.get(n.id)) as NoteStoredLocal | undefined;
      if (localNote && localNote.sync_status === 'pending') {
        logger.debug(`Skipping pull for note ${n.id} - has pending local changes`);
        return;
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
        if (
          localNote.sync_status === 'synced' &&
          !!localNote.is_archived !== serverArchived
        ) {
          logger.info(
            `Reconciling archive state for note ${n.id}: local=${localNote.is_archived} server=${serverArchived}`
          );
          await noteStore.save({ ...localNote, is_archived: serverArchived });
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
          await noteStore.save({ ...localNote, sync_status: 'pending' });
        }
        return;
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
        return;
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
      await noteStore.save(note);

      // Rebuild local note-tag associations from metadata_encrypted
      if (metaTagIds.length > 0) {
        const currentTagIds = await noteTagQueries.getTagsForNote(n.id);
        const toAdd = metaTagIds.filter((id: string) => !currentTagIds.includes(id));
        const toRemove = currentTagIds.filter((id: string) => !metaTagIds.includes(id));
        await Promise.all([
          ...toAdd.map((tagId: string) =>
            noteTagOperations
              .addTagToNote(n.id, tagId)
              .catch((e) => logger.warn('Failed to add tag to note', e))
          ),
          ...toRemove.map((tagId: string) =>
            noteTagOperations
              .removeTagFromNote(n.id, tagId)
              .catch((e) => logger.warn('Failed to remove tag from note', e))
          )
        ]);
      }
    })
  );

  // Remove local notes that no longer exist on the server (permanently deleted on another device).
  // We use include_archived=true above, so the server returns soft-deleted notes too.
  // If a note is missing from the response entirely, it was permanently deleted.
  const serverNoteIds = new Set(
    (data as Array<{ id: string }>).map((n) => n.id)
  );
  const allLocalNotes = (await noteStore.getAll()) as NoteStoredLocal[];
  const orphanNoteIds = allLocalNotes
    .filter((n) => n.sync_status === 'synced' && !serverNoteIds.has(n.id))
    .map((n) => n.id);
  if (orphanNoteIds.length > 0) {
    await noteStore.deleteMany(orphanNoteIds);
    logger.debug(`Removed ${orphanNoteIds.length} locally-synced notes no longer on server`);
  }
}

// ── Push helpers - IndexedDB → server ────────────────────────────

/**
 * Push all locally-pending items (folders, tags, notes) to the server.
 * Called during manual sync to ensure local-only items reach the server.
 */
export async function pushPendingItems(): Promise<void> {
  if (!isAuthenticated()) return;

  const [allFolders, allTags, allNotes] = await Promise.all([
    folderStore.getAll() as Promise<FolderEncrypted[]>,
    tagStore.getAll() as Promise<TagEncrypted[]>,
    noteStore.getAll() as Promise<NoteStoredLocal[]>
  ]);

  const pendingFolders = allFolders.filter((f) => f.sync_status === 'pending');
  const pendingTags = allTags.filter((t) => t.sync_status === 'pending');
  // Partition notes by is_archived: non-archived pending rows are failed
  // creates/updates and go through POST /api/notes; archived pending rows are
  // failed soft-deletes and must be retried via pushNoteDelete. Before this
  // split, a retried archived note would have been POSTed like a new note,
  // resurrecting it on the server.
  const pendingNotes = allNotes.filter(
    (n) => n.sync_status === 'pending' && !n.is_archived
  );
  const pendingArchivedNotes = allNotes.filter(
    (n) => n.sync_status === 'pending' && n.is_archived
  );

  if (
    pendingFolders.length +
      pendingTags.length +
      pendingNotes.length +
      pendingArchivedNotes.length ===
    0
  )
    return;

  logger.info(
    `Pushing pending items: ${pendingFolders.length} folders, ${pendingTags.length} tags, ${pendingNotes.length} notes, ${pendingArchivedNotes.length} archived notes`
  );

  // Push folders BFS-by-layer so parents land before children. Server's
  // POST /api/folders rejects with 404 "Parent folder not found" when
  // parent_id references a folder not yet on the server - flat
  // Promise.allSettled would 404-spam mid-batch on vault imports with
  // nested hierarchies. Siblings within a layer push in parallel.
  for (const layer of buildFolderLayers(pendingFolders)) {
    await Promise.allSettled(
      layer.map((f) =>
        serializePerEntity('folder', f.id, () =>
          pushSilently(async (idempotencyKey) => {
            const pushedFields = {
              name_encrypted: f.name_encrypted,
              parent_id: f.parent_id ?? null,
              order_index: f.order_index
            };
            const payload = { id: f.id, ...pushedFields, created_at: f.created_at };
            validateEncryptedPayload(payload as Record<string, unknown>);
            const res = await authFetch(`${PUBLIC_BASE_PATH}/api/folders`, {
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
      )
    );
  }

  // Tags don't reference folders - push in parallel after folders are
  // settled. Notes' metadata_encrypted may embed tag ids, so tags must
  // land before the notes layer below.
  await Promise.allSettled(
    pendingTags.map((t) =>
      serializePerEntity('tag', t.id, () =>
        pushSilently(async (idempotencyKey) => {
          const pushedFields = {
            name_encrypted: t.name_encrypted,
            color_encrypted: t.color_encrypted ?? null
          };
          const payload = { id: t.id, ...pushedFields, created_at: t.created_at };
          validateEncryptedPayload(payload as Record<string, unknown>);
          const res = await authFetch(`${PUBLIC_BASE_PATH}/api/tags`, {
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
    )
  );

  // Then push notes (POST for creates/updates)
  await Promise.allSettled(
    pendingNotes.map((n) =>
      serializePerEntity('note', n.id, () =>
        pushSilently(async (idempotencyKey) => {
          const pushedFields = {
            title_encrypted: n.title_encrypted,
            content_encrypted: n.content_encrypted,
            folder_id: n.folder_id ?? null,
            metadata_encrypted: n.metadata_encrypted ?? null
          };
          const payload = {
            id: n.id,
            ...pushedFields,
            metadata_encrypted: n.metadata_encrypted ?? undefined,
            created_at: n.created_at
          };
          validateEncryptedPayload(payload as Record<string, unknown>);
          const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes`, {
            method: 'POST',
            headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error(`POST /api/notes: ${res.status}`);
          const { data: resData } = await res.json();
          const current = await noteStore.get(n.id);
          if (current) {
            const stillDirty = pushedFieldsDiffer(current, pushedFields);
            await noteStore.save({
              ...current,
              sync_status: stillDirty ? 'pending' : 'synced',
              sync_version: resData?.sync_version ?? 1
            });
          }
        })
      )
    )
  );

  // Retry archived-pending notes. For notes that exist on the server
  // (sync_version > 0) we PATCH the content first, then DELETE. Without the
  // PATCH, a row whose last update push silently failed before being archived
  // keeps a server-side ciphertext that diverges from local - pull's orphan-
  // edit reconciliation flags it forever (mark pending → push DELETE only →
  // pull still sees drift → mark pending …) and "1 pending" wedges in the UI.
  // pushNoteUpdate + pushNoteDelete are serialized per-entity, so DELETE waits
  // for PATCH to land. Notes with sync_version === 0 never reached the server,
  // so there is nothing to update or delete remotely - skip both.
  for (const n of pendingArchivedNotes) {
    if ((n.sync_version ?? 0) > 0) {
      pushNoteUpdate(n.id, {
        title_encrypted: n.title_encrypted,
        content_encrypted: n.content_encrypted,
        folder_id: n.folder_id ?? null,
        metadata_encrypted: n.metadata_encrypted ?? undefined
      });
      pushNoteDelete(n.id);
    }
  }

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
      if (attempt === maxRetries) throw error;
      const delay = initialDelay * Math.pow(2, attempt);
      logger.warn(`Push attempt ${attempt + 1} failed, retrying in ${delay}ms…`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/** Fire-and-forget push after a local write. Retries up to 3× with exponential backoff. */
async function pushSilently(fn: (idempotencyKey: string) => Promise<void>): Promise<void> {
  if (!isAuthenticated()) return;
  const idempotencyKey = crypto.randomUUID();
  try {
    await retryWithBackoff(() => fn(idempotencyKey));
  } catch (err: unknown) {
    reportSyncError(err);
    logger.error('Push sync failed after retries (will retry on next periodic sync):', err);
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
  type: 'note' | 'folder' | 'tag',
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

export function pushNote(note: NoteEncrypted | NoteStoredLocal): void {
  void serializePerEntity('note', note.id, () =>
    pushSilently(async (idempotencyKey) => {
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`POST /api/notes: ${res.status}`);
      const { data } = await res.json();
      const current = await noteStore.get(note.id);
      if (current) {
        const stillDirty = pushedFieldsDiffer(current, pushedFields);
        if (stillDirty) {
          logger.debug(`Note ${note.id} changed during push - keeping sync_status=pending`);
        }
        await noteStore.save({
          ...current,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: data?.sync_version ?? 1
        });
      }
    })
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
    pushSilently(async (idempotencyKey) => {
      validateEncryptedPayload(fields as Record<string, unknown>);
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes/${id}`, {
        method: 'PATCH',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(fields)
      });
      if (!res.ok) throw new Error(`PATCH /api/notes/${id}: ${res.status}`);
      const { data } = await res.json();
      const current = await noteStore.get(id);
      if (current) {
        const stillDirty = pushedFieldsDiffer(current, fields);
        if (stillDirty) {
          logger.debug(`Note ${id} changed during push - keeping sync_status=pending`);
        }
        await noteStore.save({
          ...current,
          sync_status: stillDirty ? 'pending' : 'synced',
          sync_version: data?.sync_version ?? current.sync_version ?? 1
        });
      }
    })
  );
}

export function pushNoteDelete(id: string, permanent = false): void {
  void serializePerEntity('note', id, () =>
    pushSilently(async (idempotencyKey) => {
      const path = permanent ? `/api/notes/${id}?permanent=true` : `/api/notes/${id}`;
      const res = await authFetch(`${PUBLIC_BASE_PATH}${path}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      if (!res.ok) throw new Error(`DELETE /api/notes/${id}: ${res.status}`);
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
    })
  );
}

export function pushNoteRestore(id: string): void {
  void serializePerEntity('note', id, () =>
    pushSilently(async (idempotencyKey) => {
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes/${id}/restore`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      if (!res.ok) throw new Error(`POST /api/notes/${id}/restore: ${res.status}`);

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
    })
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/folders`, {
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/folders/${id}`, {
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/folders/${id}`, {
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/tags`, {
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/tags/${id}`, {
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
      const res = await authFetch(`${PUBLIC_BASE_PATH}/api/tags/${id}`, {
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

// ── Note version sync ──────────────────────────────────────────────

/** Push a single note version to server (fire-and-forget). Marks as synced on success. */
export function pushNoteVersion(entry: NoteHistoryEntry): void {
  void pushSilently(async (idempotencyKey) => {
    const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes/${entry.note_id}/versions`, {
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
  });
}

const PULL_VERSIONS_BATCH_SIZE = 10;

/** Pull versions for all notes from server and upsert locally (batched, max 10 concurrent). */
async function pullNoteVersions(noteIds: string[]): Promise<void> {
  for (let i = 0; i < noteIds.length; i += PULL_VERSIONS_BATCH_SIZE) {
    const batch = noteIds.slice(i, i + PULL_VERSIONS_BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (noteId) => {
        const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes/${noteId}/versions`);
        if (!res.ok) return;
        const { data } = await res.json();
        if (!Array.isArray(data)) return;

        for (const v of data as Array<{
          id: string;
          note_id: string;
          title_encrypted: string;
          content_encrypted: string;
          created_at: string;
        }>) {
          await noteHistoryStore.save({
            id: v.id,
            note_id: v.note_id,
            title_encrypted: v.title_encrypted,
            content_encrypted: v.content_encrypted,
            sync_status: 'synced',
            created_at: v.created_at
          });
        }
      })
    );
  }
}

/** Push all pending (unsynced) note versions to server. */
async function pushPendingVersions(): Promise<void> {
  const allVersions = (await noteHistoryStore.getAll()) as NoteHistoryEntry[];
  const pending = allVersions.filter((v) => v.sync_status === 'pending');
  if (pending.length === 0) return;

  logger.info(`Pushing ${pending.length} pending note versions`);
  await Promise.allSettled(
    pending.map((entry) =>
      pushSilently(async (idempotencyKey) => {
        const res = await authFetch(`${PUBLIC_BASE_PATH}/api/notes/${entry.note_id}/versions`, {
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
    )
  );
}
