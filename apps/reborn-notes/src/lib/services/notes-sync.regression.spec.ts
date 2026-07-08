import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression tests for BUG-2/3/4 (fix/offline-data-loss).
 *
 * These are intentionally source-level checks: the sync service pulls in
 * browser-only modules ($env/static/public, IndexedDB, cryptoManager) that are
 * impractical to wire up in a Node test env. A source-level assertion is the
 * cheapest way to guarantee we never re-introduce the clear-before-pull
 * pattern that caused offline data loss.
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('notes-sync - regression (offline data loss)', () => {
  it('pullFromServer does NOT clear local stores before fetching (BUG-2)', () => {
    const src = readSource('./notes-sync.service.ts');
    const pullFn = src.slice(
      src.indexOf('export async function pullFromServer'),
      src.indexOf('async function pullFolders')
    );
    expect(pullFn).not.toMatch(/noteStore\.clear\(\)/);
    expect(pullFn).not.toMatch(/folderStore\.clear\(\)/);
    expect(pullFn).not.toMatch(/tagStore\.clear\(\)/);
    expect(pullFn).not.toMatch(/noteHistoryStore\.clear\(\)/);
  });

  it('online handler pushes pending items BEFORE pulling (BUG-3)', () => {
    const src = readSource('../stores/sync-status.store.ts');
    // The online-transition handler now lives inside a connectivity.subscribe
    // callback (we replaced navigator.onLine with a probe-backed store). Scope
    // the check to that callback block.
    const anchor = src.indexOf('connectivity.subscribe');
    expect(anchor).toBeGreaterThan(-1);
    const onlineHandler = src.slice(anchor, anchor + 1500);
    const pushCallIdx = onlineHandler.search(/pushPendingItems\s*\(/);
    const pullCallIdx = onlineHandler.search(/pullFromServer\s*\(/);
    expect(pushCallIdx).toBeGreaterThan(-1);
    expect(pullCallIdx).toBeGreaterThan(-1);
    expect(pushCallIdx).toBeLessThan(pullCallIdx);
    // Both calls must be awaited (sequential), not parallel fire-and-forget.
    expect(onlineHandler).toMatch(/await\s+pushPendingItems/);
    expect(onlineHandler).toMatch(/await\s+pullFromServer/);
  });

  it('layout initial sync pushes pending items BEFORE pulling (BUG-4)', () => {
    const src = readSource('../../routes/+layout.svelte');
    // Skip past the import statement on L18 that lists both names.
    const bodyStart = src.indexOf('<script');
    const afterImports = src.indexOf('onMount', bodyStart);
    const body = src.slice(afterImports);

    // Two sync paths exist: the $effect runSync() and the onMount block.
    // Each must call pushPendingItems before pullFromServer.
    const pushCalls = [...body.matchAll(/pushPendingItems\s*\(/g)];
    expect(pushCalls.length).toBeGreaterThanOrEqual(2);

    // First pushPendingItems call must precede first pullFromServer call.
    const firstPushCall = body.search(/pushPendingItems\s*\(/);
    const firstPullCall = body.search(/pullFromServer\s*\(/);
    expect(firstPushCall).toBeGreaterThan(-1);
    expect(firstPullCall).toBeGreaterThan(-1);
    expect(firstPushCall).toBeLessThan(firstPullCall);
  });

  it('layout pulls on in-app navigation and tab-return via a shared-cooldown activitySync (freshness)', () => {
    const src = readSource('../../routes/+layout.svelte');
    // In-app navigation triggers a pull, skipping the initial load (from===null).
    expect(src).toMatch(/afterNavigate\s*\(/);
    expect(src).toMatch(/nav\.from === null/);
    // The pull runs through activitySync, which is cooldown-gated and push-first.
    const activity = src.slice(
      src.indexOf('function activitySync'),
      src.indexOf('function activitySync') + 700
    );
    expect(activity).toMatch(/ACTIVITY_SYNC_DEBOUNCE_MS/);
    const pushIdx = activity.search(/pushPendingItems\s*\(/);
    const pullIdx = activity.search(/pullFromServer\s*\(/);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(pullIdx).toBeGreaterThan(pushIdx);
    // The tab-return (visibilitychange) handler delegates to the SAME activitySync
    // so both triggers share one 30s cooldown and coalesce.
    expect(src).toMatch(/onForegroundSync\s*=\s*\(\)\s*=>\s*\{[\s\S]*?activitySync\(\)/);
    // Switching notes / IconNav sections is STATE within the '/' route, not a
    // route navigation, so a capture-phase pointerdown drives the same
    // activitySync (can't miss a specific view-state variable).
    expect(src).toMatch(/onPointerActivity\s*=\s*\(\)\s*=>\s*activitySync\(\)/);
    expect(src).toMatch(
      /addEventListener\(\s*['"]pointerdown['"]\s*,\s*onPointerActivity\s*,\s*\{\s*capture:\s*true/
    );
  });

  it('delete/restore push ops are serialized per-entity (BUG-5 part A/B/C)', () => {
    const src = readSource('./notes-sync.service.ts');

    // The helper itself must exist.
    expect(src).toMatch(/function\s+serializePerEntity\s*</);

    // Every push* that mutates a single (type, id) must route through it,
    // otherwise the network can reorder the wire and diverge server vs local.
    const mustSerialize: Array<[RegExp, 'note' | 'folder' | 'tag' | 'savedSearch']> = [
      [/export function pushNote\b/, 'note'],
      [/export function pushNoteUpdate\b/, 'note'],
      [/export function pushNoteDelete\b/, 'note'],
      [/export function pushNoteRestore\b/, 'note'],
      [/export function pushFolder\b/, 'folder'],
      [/export function pushFolderUpdate\b/, 'folder'],
      [/export function pushFolderDelete\b/, 'folder'],
      [/export function pushTag\b/, 'tag'],
      [/export function pushTagUpdate\b/, 'tag'],
      [/export function pushTagDelete\b/, 'tag'],
      [/export function pushSavedSearch\b/, 'savedSearch'],
      [/export function pushSavedSearchUpdate\b/, 'savedSearch'],
      [/export function pushSavedSearchDelete\b/, 'savedSearch']
    ];
    for (const [signature, type] of mustSerialize) {
      const match = signature.exec(src);
      expect(match, `signature not found: ${signature}`).not.toBeNull();
      const start = match!.index;
      // Scan only the next ~600 chars - long enough for the wrapper, short
      // enough to avoid crossing into the next function.
      const body = src.slice(start, start + 600);
      expect(body, `${signature} must call serializePerEntity('${type}', …)`).toMatch(
        new RegExp(`serializePerEntity\\(\\s*'${type}'`)
      );
    }
  });

  it('pushNoteDelete chains restore when is_archived flipped during push (BUG-5 A)', () => {
    const src = readSource('./notes-sync.service.ts');
    const body = src.slice(
      src.indexOf('export function pushNoteDelete'),
      src.indexOf('export function pushNoteRestore')
    );
    // Intent-check branch: if current.is_archived is false, chain restore.
    expect(body).toMatch(/current\.is_archived/);
    expect(body).toMatch(/pushNoteRestore\s*\(\s*id\s*\)/);
    // Must keep sync_status pending when intent flipped.
    expect(body).toMatch(/sync_status:\s*'pending'/);
  });

  it('pushNoteRestore chains delete when is_archived flipped during push (BUG-5 A)', () => {
    const src = readSource('./notes-sync.service.ts');
    const body = src.slice(
      src.indexOf('export function pushNoteRestore'),
      src.indexOf('export function pushFolder')
    );
    expect(body).toMatch(/current\.is_archived/);
    expect(body).toMatch(/pushNoteDelete\s*\(\s*id\s*\)/);
    // Old bug: sync_version clobbered to 1 after restore. Must NOT reappear.
    expect(body).not.toMatch(/sync_version:\s*1\b/);
  });

  it('pushFolderDelete / pushTagDelete do not clobber sync_version to 1 (BUG-5)', () => {
    const src = readSource('./notes-sync.service.ts');

    const folderDelete = src.slice(
      src.indexOf('export function pushFolderDelete'),
      src.indexOf('export function pushTag\b') !== -1
        ? src.indexOf('export function pushTag\b')
        : src.indexOf('export function pushTag(')
    );
    expect(folderDelete).not.toMatch(/sync_version:\s*1\b/);

    const tagDelete = src.slice(src.indexOf('export function pushTagDelete'));
    expect(tagDelete).not.toMatch(/sync_version:\s*1\b/);
  });

  it('pushPendingItems partitions archived pending notes into delete retries (BUG-5)', () => {
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );
    // Non-archived pending notes still POST /api/notes.
    expect(fn).toMatch(/const\s+pendingNotes\s*=\s*allNotes\.filter/);
    expect(fn).toMatch(/!n\.is_archived/);
    // Archived pending notes get their own bucket and go through pushNoteDelete.
    expect(fn).toMatch(/const\s+pendingArchivedNotes\s*=\s*allNotes\.filter/);
    expect(fn).toMatch(/pushNoteDelete\s*\(\s*n\.id\s*\)/);
  });

  it('soft-delete and restore endpoints bump sync_version and return it (BUG-6)', () => {
    const deleteSrc = readFileSync(
      resolve(__dirname, '../../routes/api/notes/[id]/+server.ts'),
      'utf-8'
    );
    // Soft delete branch (the non-permanent one) must bump sync_version and
    // return the new value, otherwise pull-side version gate skips the archive
    // propagation on the second device.
    const deleteHandler = deleteSrc.slice(deleteSrc.indexOf('export const DELETE'));
    expect(deleteHandler).toMatch(/deleted_at:\s*new Date\(\)/);
    expect(deleteHandler).toMatch(/sync_version:\s*\{\s*increment:\s*1\s*\}/);
    expect(deleteHandler).toMatch(/sync_version:\s*updated\.sync_version/);

    const restoreSrc = readFileSync(
      resolve(__dirname, '../../routes/api/notes/[id]/restore/+server.ts'),
      'utf-8'
    );
    const restoreHandler = restoreSrc.slice(restoreSrc.indexOf('export const POST'));
    expect(restoreHandler).toMatch(/deleted_at:\s*null/);
    expect(restoreHandler).toMatch(/sync_version:\s*\{\s*increment:\s*1\s*\}/);
    expect(restoreHandler).toMatch(/sync_version:\s*updated\.sync_version/);
  });

  it('pushNoteDelete/pushNoteRestore do NOT mirror the server sync_version onto local (audit 2026-07-08 finding A)', () => {
    // Mirroring the bumped server sync_version onto a local row whose content was
    // NOT refreshed breaks rule-10's "equal version + differing ciphertext =>
    // local holds the newer unpushed edit" invariant: a note archived/restored on
    // one device would then re-push its stale content over a peer's newer content
    // edit (silent data loss). The callbacks must leave sync_version at its
    // pre-delete value so the next pull adopts the server content via the
    // strict-greater gate. The SERVER still bumps its own version (asserted in the
    // BUG-6 endpoint test above) so other devices pick up the archive state.
    const src = readSource('./notes-sync.service.ts');

    const deleteBody = src.slice(
      src.indexOf('export function pushNoteDelete'),
      src.indexOf('export function pushNoteRestore')
    );
    const restoreBody = src.slice(
      src.indexOf('export function pushNoteRestore'),
      src.indexOf('export function pushFolder')
    );
    // No server-version mirror in either callback.
    expect(deleteBody).not.toMatch(/serverSyncVersion/);
    expect(deleteBody).not.toMatch(/sync_version:\s*data/);
    expect(restoreBody).not.toMatch(/serverSyncVersion/);
    expect(restoreBody).not.toMatch(/sync_version:\s*data/);
    // Intent-check (rule 11.b) stays: branch on current.is_archived, chain opposite op.
    expect(deleteBody).toMatch(/current\.is_archived/);
    expect(deleteBody).toMatch(/pushNoteRestore\s*\(\s*id\s*\)/);
    expect(restoreBody).toMatch(/current\.is_archived/);
    expect(restoreBody).toMatch(/pushNoteDelete\s*\(\s*id\s*\)/);
  });

  it('pullNotes reconciles is_archived when server differs, even at equal sync_version (BUG-6)', () => {
    const src = readSource('./notes-sync.service.ts');
    const pullNotes = src.slice(
      src.indexOf('async function pullNotes'),
      src.indexOf('// ── Push helpers')
    );
    // The equal-version branch must check !!localNote.is_archived against
    // serverArchived and save when they differ.
    expect(pullNotes).toMatch(/serverArchived\s*=\s*!!n\.deleted_at\s*\|\|\s*!!n\.is_archived/);
    expect(pullNotes).toMatch(/!!localNote\.is_archived\s*!==\s*serverArchived/);
    expect(pullNotes).toMatch(/is_archived:\s*serverArchived/);
  });

  // ── Multi-device reconciliation audit (2026-07-08) ──────────────────────

  it('deleteNote gates "never on server" on sync_version===0, not sync_status (finding B)', () => {
    const src = readSource('./note.service.ts');
    const fn = src.slice(
      src.indexOf('export async function deleteNote'),
      src.indexOf('export async function moveNoteToFolder')
    );
    // Skip-DELETE branch keys off sync_version (the on-server signal), NOT
    // sync_status: a pending note that IS on the server must still be soft-
    // deleted, else the next pull's archive reconcile un-archives it out of trash.
    expect(fn).toMatch(/!existing\s*\|\|\s*\(existing\.sync_version\s*\?\?\s*0\)\s*===\s*0/);
    // A pending-on-server note PATCHes its unpushed content BEFORE the DELETE
    // (DELETE carries no ciphertext, so otherwise the unsynced edit is lost).
    expect(fn).toMatch(
      /if\s*\(existing\.sync_status\s*===\s*'pending'\)\s*\{[\s\S]*?pushNoteUpdate\s*\(\s*id\s*,/
    );
    expect(fn).toMatch(/pushNoteDelete\s*\(\s*id\s*\)/);
  });

  it('emptyTrash gates the permanent DELETE on sync_version>0, not sync_status (finding C)', () => {
    const src = readSource('./note.service.ts');
    const fn = src.slice(
      src.indexOf('export async function emptyTrash'),
      src.indexOf('export async function cleanTrash')
    );
    expect(fn).toMatch(/\(n\.sync_version\s*\?\?\s*0\)\s*>\s*0/);
    expect(fn).toMatch(/pushNoteDelete\s*\(\s*n\.id\s*,\s*true\s*\)/);
    // Must NOT skip on sync_status pending - that hard-deleted the row locally
    // but left it on the server, resurrecting the note on the next pull.
    expect(fn).not.toMatch(/n\.sync_status\s*!==\s*'pending'/);
  });

  it('pullNotes holds the delta watermark at the earliest unpersisted row (finding G)', () => {
    const src = readSource('./notes-sync.service.ts');
    const pullNotes = src.slice(
      src.indexOf('async function pullNotes'),
      src.indexOf('async function writeNotesPage')
    );
    // writeNotesPage reports the earliest row it failed to persist; pullNotes
    // caps the watermark there so the next ?since delta re-fetches it instead of
    // skipping it forever.
    expect(pullNotes).toMatch(/earliestUnaccounted/);
    expect(pullNotes).toMatch(
      /const\s+nextWatermark\s*=\s*earliestUnaccounted\s*\?\?\s*maxUpdatedAt/
    );
    expect(pullNotes).toMatch(/writeWatermark\(userId,\s*nextWatermark\)/);

    const writePage = src.slice(
      src.indexOf('async function writeNotesPage'),
      src.indexOf('// ── Push helpers')
    );
    // Shadow-index throw path records the row as unaccounted; saveMany failures
    // (no row ids) conservatively hold at the earliest fresh upsert.
    expect(writePage).toMatch(/unaccountedUpdatedAts\.push\(n\.updated_at\)/);
    expect(writePage).toMatch(/freshUpsertUpdatedAts/);
    expect(writePage).toMatch(/minUnaccounted/);
  });

  it('pull helpers remove ghost items (synced locally but deleted on server)', () => {
    const src = readSource('./notes-sync.service.ts');

    // pullFolders must clean up orphaned synced folders
    const pullFolders = src.slice(
      src.indexOf('async function pullFolders'),
      src.indexOf('async function pullTags')
    );
    expect(pullFolders).toMatch(/folderStore\.deleteMany/);
    expect(pullFolders).toMatch(/sync_status.*===.*'synced'/);

    // pullTags must clean up orphaned synced tags
    const pullTags = src.slice(
      src.indexOf('async function pullTags'),
      src.indexOf('async function pullNotes')
    );
    expect(pullTags).toMatch(/tagStore\.deleteMany/);
    expect(pullTags).toMatch(/sync_status.*===.*'synced'/);

    // pullNotes must clean up orphaned synced notes
    const pullNotes = src.slice(
      src.indexOf('async function pullNotes'),
      src.indexOf('// ── Push helpers')
    );
    expect(pullNotes).toMatch(/noteStore\.deleteMany/);
    expect(pullNotes).toMatch(/sync_status.*===.*'synced'/);
  });

  it('pullFolders repairs parent_id cycles after the orphan sweep (audit 013 N2)', () => {
    // The server accepts concurrent cross-device moves that close a parent_id
    // cycle; cycle members are unreachable from the roots and silently vanish
    // from every folder view. Pull must detect cycles over the post-sweep
    // local mirror, reparent one member per cycle to the root with
    // sync_status:'pending' in the SAME save, and push the repair.
    const src = readSource('./notes-sync.service.ts');
    const pullFolders = src.slice(
      src.indexOf('async function pullFolders'),
      src.indexOf('async function pullTags')
    );
    const orphanSweepIdx = pullFolders.search(/folderStore\.deleteMany/);
    const repairIdx = pullFolders.search(/planCycleRepairs/);
    expect(orphanSweepIdx).toBeGreaterThan(-1);
    expect(repairIdx).toBeGreaterThan(orphanSweepIdx);
    // The repair write clears the parent and marks pending atomically…
    expect(pullFolders).toMatch(
      /parent_id:\s*undefined,\s*\n\s*sync_status:\s*'pending'/
    );
    // …and the repaired parent lands on the server like a user move.
    expect(pullFolders).toMatch(/pushFolderUpdate\(folderId,\s*\{\s*parent_id:\s*null\s*\}\)/);
  });

  it('pushPendingItems pushes folders BFS-by-layer (parent before child)', () => {
    // Server's POST /api/folders FK-checks parent_id and 404s if the parent
    // isn't on the server yet. A flat fan-out would 404-spam mid-batch on
    // nested vault imports - pushPendingItems must use buildFolderLayers and
    // await each layer (via settleInBatches) before starting the next.
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );

    // Must consume the layered helper.
    expect(fn).toMatch(/buildFolderLayers\s*\(\s*pendingFolders\s*\)/);

    // The folder push must live inside `for (const layer of …)` with an
    // awaited per-layer sweep. Loose match: `for` block appears, and within
    // the file, the `/api/folders` POST is reachable only through that loop.
    expect(fn).toMatch(/for\s*\(\s*const\s+layer\s+of\s+buildFolderLayers/);

    // Sanity: folders and tags push in SEPARATE sweeps (if they shared one,
    // layering wouldn't matter). Between the folders POST and the tags POST
    // there must be a fresh `await settleInBatches(pendingTags, …)`.
    const foldersPostIdx =
      fn.indexOf("'/api/folders'") >= 0 ? fn.indexOf("'/api/folders'") : fn.indexOf('/api/folders');
    const tagsPostIdx =
      fn.indexOf("'/api/tags'") >= 0 ? fn.indexOf("'/api/tags'") : fn.indexOf('/api/tags');
    expect(foldersPostIdx).toBeGreaterThan(-1);
    expect(tagsPostIdx).toBeGreaterThan(-1);
    const between = fn.slice(foldersPostIdx, tagsPostIdx);
    expect(between).toMatch(/await\s+settleInBatches\(\s*pendingTags\b/);
  });

  it('pushPendingItems sends PATCH before DELETE for archived notes with server-side history', () => {
    // Regression for the "orphaned note edit" pull-warn loop on archived
    // notes (incident 2026-05-17, note 050a8227-bbfe-437e-b703-98f8ef7804bd):
    // when a content PATCH push silently failed before the user archived the
    // note, pushPendingItems used to send only DELETE, which doesn't carry
    // ciphertext. Server kept stale ciphertext, pull's orphan-edit branch
    // flagged the row pending again, push DELETE'd again, loop. The fix sends
    // PATCH (via pushNoteUpdate) before DELETE (via pushNoteDelete), gated by
    // sync_version > 0 so notes that never reached the server stay local-only.
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );

    // Locate the archived-pending retry sweep and assert it gates on
    // sync_version (notes that never reached the server are skipped).
    const anchorIdx = fn.search(
      /const\s+retriableArchivedNotes\s*=\s*pendingArchivedNotes\.filter/
    );
    expect(anchorIdx).toBeGreaterThan(-1);
    const loopBody = fn.slice(anchorIdx);
    expect(loopBody).toMatch(/n\.sync_version\s*\?\?\s*0\)?\s*>\s*0/);

    // PATCH (pushNoteUpdate) must appear before DELETE (pushNoteDelete).
    const patchIdx = loopBody.search(/pushNoteUpdate\s*\(/);
    const deleteIdx = loopBody.search(/pushNoteDelete\s*\(/);
    expect(patchIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeLessThan(deleteIdx);
  });

  it('pushPendingItems caps every fan-out via settleInBatches (no flat Promise.allSettled)', () => {
    // Regression for the mass-push burst (Michał's ~195-note folder import,
    // 2026-06-14): a flat Promise.allSettled over every pending item fired the
    // whole burst at once, saturating the server's shared pg pool (node-pg
    // default max 10, connectionTimeoutMillis 0 → queries queue forever instead
    // of erroring). Every sweep must route through settleInBatches (cap
    // SYNC_BATCH_SIZE), never a bare allSettled. See sync-batch.ts.
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );

    // Each in-function sweep goes through the helper.
    expect(fn).toMatch(/settleInBatches\(\s*layer\b/); // folders, per BFS layer
    expect(fn).toMatch(/settleInBatches\(\s*pendingTags\b/);
    expect(fn).toMatch(/settleInBatches\(\s*pendingSavedSearches\b/);
    expect(fn).toMatch(/settleInBatches\(\s*pendingNotes\b/);
    expect(fn).toMatch(/settleInBatches\(\s*retriableArchivedNotes\b/);

    // No bare Promise.allSettled CALL left in the function body - those WERE
    // the unbounded bursts. The bounded one now lives inside settleInBatches.
    // (Matches a call `Promise.allSettled(`, not the word in a comment.)
    expect(fn).not.toMatch(/Promise\.allSettled\s*\(/);

    // The tail version push still shares the cap. The bulk pull-side version
    // fetch is gone - history is fetched per-note on demand in stage 2a. Only
    // versions whose parent note is on the server (sync_version > 0) are pushed
    // through the bounded helper; orphaned ones are dropped so a missing parent
    // never 404-loops the sweep.
    const versionsStart = src.indexOf('async function pushPendingVersions');
    const versionsFn = src.slice(versionsStart, versionsStart + 2400);
    expect(versionsFn).toMatch(/settleInBatches\(\s*pushable\b/);
    expect(versionsFn).toMatch(/sync_version\s*\?\?\s*0\)\s*>\s*0/);
    expect(versionsFn).toMatch(/deleteMany\(orphanIds\)/);
    // The bespoke pull-versions batch constant is gone (unified onto the helper).
    expect(src).not.toMatch(/PULL_VERSIONS_BATCH_SIZE/);
  });

  it('orchestrator no longer backfills version history (lazy on-demand path)', () => {
    // Stage 2a: the bulk cold-start version backfill is gone from the pull
    // critical path (it cost 1 GET/note, ~31s native for 503 notes). History is
    // now fetched on demand when the panel opens (note.service
    // syncNoteVersionsFromServer), so the orchestrator must not pull versions or
    // drive the removed isSyncingHistory phase. See guideline 36.
    const src = readSource('./notes-sync.service.ts');
    const orchestrator = src.slice(
      src.indexOf('async function runPullFromServer'),
      src.indexOf('async function pullFolders')
    );
    expect(orchestrator).not.toMatch(/pullNoteVersions/);
    expect(orchestrator).not.toMatch(/isSyncingHistory/);
    expect(orchestrator).not.toMatch(/historyBackfillsInFlight/);
    // pullNotes is still called (its changed-id result is unused in 2a, kept for 2b).
    expect(orchestrator).toMatch(/await pullNotes\(/);
  });

  it('on-demand history sync fetches per note, batches the write, and prunes', () => {
    // The single-note fetch helper survives (the bulk many-id variant is gone)
    // and keeps the batched write: saveMany is one transaction per note, avoiding
    // the per-row churn that OOM'd the Android WebView on the notes path (PR #353).
    const syncSrc = readSource('./notes-sync.service.ts');
    expect(syncSrc).toMatch(/export async function pullNoteVersionsForNote\(noteId: string\)/);
    const helper = syncSrc.slice(
      syncSrc.indexOf('export async function pullNoteVersionsForNote'),
      syncSrc.indexOf('async function pushPendingVersions')
    );
    expect(helper).toMatch(/noteHistoryStore\.saveMany\(/);
    expect(helper).not.toMatch(/noteHistoryStore\.save\(/);

    // note.service wraps it as an online-only, best-effort sync that prunes to
    // the version cap and degrades gracefully (offline → local history).
    const noteSrc = readSource('./note.service.ts');
    const fn = noteSrc.slice(
      noteSrc.indexOf('export async function syncNoteVersionsFromServer'),
      noteSrc.indexOf('export async function getNoteHistoryDecrypted')
    );
    expect(fn).toMatch(/checkOnline\(/);
    expect(fn).toMatch(/pullNoteVersionsForNote\(/);
    expect(fn).toMatch(/pruneVersions\(/);
  });

  it('version history panel syncs from server before reading local history', () => {
    // VersionHistorySheet.loadHistory must fetch server versions (on demand)
    // BEFORE decrypting/reading local history, so the panel reflects other
    // devices' snapshots when online and falls back to local when offline.
    const sheet = readSource('../components/VersionHistorySheet.svelte');
    const loadHistory = sheet.slice(sheet.indexOf('async function loadHistory'));
    const syncIdx = loadHistory.search(/syncNoteVersionsFromServer\s*\(/);
    const readIdx = loadHistory.search(/getNoteHistoryDecrypted\s*\(/);
    expect(syncIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeLessThan(readIdx);
  });

  it('archived-pending retry joins the per-entity chain so the cap is real', () => {
    // pushNoteUpdate/pushNoteDelete are fire-and-forget (void). If the sweep
    // didn't await something, settleInBatches would enqueue every archived note
    // at once and the cap would be a no-op. The task must await a trailing
    // serializePerEntity('note', …) so it only settles after the queued
    // PATCH+DELETE run - that's what gives the batch real backpressure.
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );
    const anchorIdx = fn.search(
      /const\s+retriableArchivedNotes\s*=\s*pendingArchivedNotes\.filter/
    );
    expect(anchorIdx).toBeGreaterThan(-1);
    const sweep = fn.slice(anchorIdx);
    expect(sweep).toMatch(/await\s+settleInBatches\(\s*retriableArchivedNotes\b/);
    // The trailing join: a no-op chained on the same note entity, awaited.
    expect(sweep).toMatch(
      /await\s+serializePerEntity\(\s*'note',\s*n\.id,\s*\(\)\s*=>\s*Promise\.resolve\(\)\s*\)/
    );
  });

  it('importJsonBackup defers all pushes to pushPendingItems (ordering)', () => {
    // Production reproduction: backup with 7 folders + 85 notes triggered ~25
    // simultaneous "POST /api/notes 404 Folder not found" errors during import
    // because per-loop fire-and-forget pushFolder/pushNote raced - notes POST
    // reached the server before their parent folder POST completed, the
    // server's FK check missed the folder, and 404 came back. pushPendingItems
    // already runs `Promise.allSettled([folders + tags]) → Promise.allSettled
    // (notes)` so it's the safe single push path. Mirrors the importFolder
    // fix below.
    const src = readSource('./export-import.service.ts');

    const importStart = src.indexOf('export async function importJsonBackup');
    const importEnd = src.indexOf('\n/**', importStart);
    expect(importStart).toBeGreaterThan(-1);
    expect(importEnd).toBeGreaterThan(importStart);
    const importBody = src.slice(importStart, importEnd);

    // No per-element pushFolder/pushTag/pushNote in importJsonBackup - all
    // imports save with sync_status='pending' and rely on pushPendingItems.
    expect(importBody).not.toMatch(/\bpushFolder\s*\(/);
    expect(importBody).not.toMatch(/\bpushTag\s*\(/);
    expect(importBody).not.toMatch(/\bpushNote\s*\(/);
    // pushPendingItems must still fire at the tail.
    expect(importBody).toMatch(/pushPendingItems\s*\(/);
  });

  it('importFolder bulk-pushes via pushPendingItems, not per-note pushNote', () => {
    // Without ordering, notes POST before their just-created folders land,
    // and the server's folder_id FK check returns 404. The fix routes every
    // create through skipSync and finishes with one ordered pushPendingItems().
    const src = readSource('./export-import.service.ts');

    // Helpers (findOrCreateFolderByPath / findOrCreateTagByName) live above
    // importFolder. Scope the skipSync checks to that helper region so we
    // don't accidentally match unrelated callsites.
    const helpersStart = src.indexOf('async function findOrCreateFolderByPath');
    const importFolderStart = src.indexOf('export async function importFolder');
    expect(helpersStart).toBeGreaterThan(-1);
    expect(importFolderStart).toBeGreaterThan(helpersStart);
    const helpers = src.slice(helpersStart, importFolderStart);

    expect(helpers).toMatch(/FolderService\.createFolder\([^)]*\{\s*skipSync:\s*true\s*\}\s*\)/);
    expect(helpers).toMatch(/TagService\.createTag\([^)]*\{\s*skipSync:\s*true\s*\}\s*\)/);

    // No direct pushNote/pushFolder/pushTag calls inside importFolder -
    // pushPendingItems() is the single push path so order is enforced.
    const importFolder = src.slice(importFolderStart);
    expect(importFolder).not.toMatch(/\bpushNote\s*\(/);
    expect(importFolder).not.toMatch(/\bpushFolder\s*\(/);
    expect(importFolder).not.toMatch(/\bpushTag\s*\(/);
    expect(importFolder).toMatch(/pushPendingItems\s*\(/);
  });

  // ── user_id resilience (regression: production imports failing with
  //    "user_id: Invalid input" because legacy IDB / sync race wrote null)
  it('importJsonBackup overrides user_id BEFORE safeParse in folder/tag/note loops', () => {
    // The schema requires user_id to be a UUID; the importer always
    // overwrites it with the current account's userId on save. Setting it
    // before validation (instead of after) makes legacy backups with
    // null/missing/invalid user_id pass - the value from the file is dead
    // weight we don't use. See guideline 44.
    const src = readSource('./export-import.service.ts');

    const folderLoopStart = src.indexOf('for (const folder of backupData.folders');
    const folderSafeParseIdx = src.indexOf('FolderEncryptedSchema.safeParse', folderLoopStart);
    expect(folderSafeParseIdx).toBeGreaterThan(folderLoopStart);
    const folderPreValidate = src.slice(folderLoopStart, folderSafeParseIdx);
    expect(folderPreValidate).toMatch(/normalized\.user_id\s*=\s*userId/);

    const tagLoopStart = src.indexOf('for (const tag of backupData.tags');
    const tagSafeParseIdx = src.indexOf('TagEncryptedSchema.safeParse', tagLoopStart);
    expect(tagSafeParseIdx).toBeGreaterThan(tagLoopStart);
    const tagPreValidate = src.slice(tagLoopStart, tagSafeParseIdx);
    expect(tagPreValidate).toMatch(/normalized\.user_id\s*=\s*userId/);

    const noteLoopStart = src.indexOf('for (let i = 0; i < notes.length; i++)');
    const noteSafeParseIdx = src.indexOf('NoteEncryptedSchema.safeParse', noteLoopStart);
    expect(noteSafeParseIdx).toBeGreaterThan(noteLoopStart);
    const notePreValidate = src.slice(noteLoopStart, noteSafeParseIdx);
    expect(notePreValidate).toMatch(/normalized\.user_id\s*=\s*userId/);
  });

  it('pull helpers capture userId once at the top instead of `userId!` in each save', () => {
    // Non-null assertions on `get(authStore).userId` silently produced
    // `undefined` when sync raced auth hydration / logout, polluting the
    // local user_id. The guard returns early if userId isn't present and
    // every save uses the captured value. See guideline 44.
    const src = readSource('./notes-sync.service.ts');

    for (const fnName of ['pullFolders', 'pullTags', 'pullNotes']) {
      const start = src.indexOf(`async function ${fnName}`);
      expect(start, `${fnName} not found`).toBeGreaterThan(-1);
      // Bound the function body - stop at the next top-level `async function`
      // or the push-helpers section header.
      const after = src.slice(start);
      const nextFnIdx = after.indexOf('\nasync function ', 1);
      const sectionEndIdx = after.indexOf('// ── Push helpers');
      const candidates = [nextFnIdx, sectionEndIdx].filter((i) => i > 0);
      const end = candidates.length > 0 ? Math.min(...candidates) : after.length;
      const body = after.slice(0, end);

      // userId is captured at the top.
      expect(body, `${fnName} must capture userId at top`).toMatch(
        /const\s+userId\s*=\s*get\(authStore\)\.userId/
      );
      // Bail out when userId is absent. (pullNotes returns string[] so its
      // guard is `return []`; the void pull helpers use bare `return;`.)
      expect(body, `${fnName} must early-return on missing userId`).toMatch(
        /if\s*\(\s*!userId\s*\)\s*return\b[^;]*;/
      );
      // No more non-null assertions on authStore.userId inside the body.
      expect(body, `${fnName} must not use \`get(authStore).userId!\``).not.toMatch(
        /get\(authStore\)\.userId!/
      );
    }
  });

  it('cleanup migration is awaited before pull and receives the current userId', () => {
    const src = readSource('../../routes/+layout.svelte');
    expect(src).toMatch(/await\s+cleanupNullFkFields\s*\(\s*get\(authStore\)\.userId\s*\)/);
    // The flag was bumped to v2 to re-run the cleanup with user_id repair
    // included. Ensure we never silently re-use the v1 flag.
    const cleanupSrc = readSource('./idb-cleanup.service.ts');
    expect(cleanupSrc).toMatch(/idb-null-fk-cleanup-v2/);
    expect(cleanupSrc).not.toMatch(
      /^const\s+FLAG_KEY\s*=\s*'reborn-notes:idb-null-fk-cleanup-v1'/m
    );
  });

  it('v1 export sanitizer stamps current userId into records with invalid user_id', () => {
    // normalizeExportUuids gets a userIdReplacement parameter; exportJsonBackup
    // (the v1 account-key backup) must pass the current account's userId so
    // legacy IDB pollution (user_id: null/missing) doesn't propagate into
    // freshly-emitted backup files.
    const src = readSource('./export-import.service.ts');
    expect(src).toMatch(
      /function\s+normalizeExportUuids[\s\S]{0,300}?userIdReplacement\?:\s*string/
    );

    // Bound the slice at the portable-backup section that follows exportJsonBackup.
    const fullExport = src.slice(
      src.indexOf('export async function exportJsonBackup'),
      src.indexOf('// ── Portable backup')
    );
    expect(fullExport).toMatch(/get\(authStore\)\.userId/);
    // All three normalize calls in this function must thread userId through.
    expect(fullExport.match(/normalizeExportUuids\s*\(/g)?.length).toBe(3);
    // Walk each call manually with paren-balancing so nested calls in the
    // first argument (e.g. `notes.map(stripNoteShadowIndexes)`) don't fool
    // a naive `slice(0, indexOf(')'))`.
    function* eachCall(text: string, fnName: string): Generator<string> {
      const re = new RegExp(`${fnName}\\s*\\(`, 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        let depth = 1;
        let i = match.index + match[0].length;
        while (i < text.length && depth > 0) {
          const ch = text[i];
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          i++;
        }
        yield text.slice(match.index + match[0].length, i - 1);
      }
    }
    for (const argList of eachCall(fullExport, 'normalizeExportUuids')) {
      expect(argList, `normalizeExportUuids call must thread userId: ${argList}`).toMatch(/userId/);
    }
  });

  it('importJsonBackup routes a v3 portable backup through reencryptPortablePayload', () => {
    // The v3 branch must re-encrypt the plaintext payload with the CURRENT
    // account key (via the injected cryptoManager) before the shared loops run -
    // that is what makes a portable backup land readable on any account. The
    // round-trip behavior itself is covered by portable-backup-utils.spec.ts.
    const src = readSource('./export-import.service.ts');
    expect(src).toMatch(/from '\.\/portable-backup-utils'/);
    const v3Branch = src.slice(
      src.indexOf('if (parsed.version === 3)'),
      src.indexOf('} else if (parsed.version === 1)')
    );
    expect(v3Branch).toMatch(/reencryptPortablePayload\(\s*cryptoManager,/);
    expect(v3Branch).toMatch(/cryptoManager\.isInitialized\(\)/);
  });

  it('pullNotes routes shadow-index decoding through extractShadowIndexes and skips save on throw', () => {
    const src = readSource('./notes-sync.service.ts');
    const pullNotes = src.slice(
      src.indexOf('async function pullNotes'),
      src.indexOf('// ── Push helpers')
    );
    // Must call the typed helper, not an inline cryptoManager.decryptObject. The
    // inline pattern was the original silent-default trap that wrote is_pinned:
    // false / is_starred: false on transient crypto-not-ready.
    expect(pullNotes).toMatch(/extractShadowIndexes\s*\(/);
    expect(pullNotes).not.toMatch(/cryptoManager\.decryptObject<NoteSensitiveMetadata>/);

    // The catch block following extractShadowIndexes must skip the noteStore.save
    // for this iteration (return from the map callback). Anchor on the actual
    // call expression (not a comment mention) and look for try/catch/return.
    const callMatch = /await\s+extractShadowIndexes\s*\(/.exec(pullNotes);
    expect(callMatch).not.toBeNull();
    const window = pullNotes.slice(callMatch!.index, callMatch!.index + 900);
    expect(window).toMatch(/catch\s*\(/);
    // Skip path returns `null` from the map callback (pullNotes collects the
    // ids it actually wrote; skipped notes contribute null and are filtered).
    // The catch also records the row as unaccounted so the watermark is held
    // back (fix G) - the return-null skip still follows it.
    expect(window).toMatch(/unaccountedUpdatedAts\.push/);
    expect(window).toMatch(/return null;/);
  });

  it('pullNotes batches note writes via saveMany, never per-note save (Android OOM)', () => {
    // Regression for the first-sync crash on a large account (503 notes, many
    // long): noteStore.save() runs refreshItems() - a full getAll() over the
    // entire notes table (every content_encrypted blob) - on every call. Firing
    // one per note (503 concurrent) made memory grow ~O(n²) and OOM-killed the
    // in-process Android System WebView at ~40 s; iOS WKWebView (out of process)
    // absorbed the same spike. The pull must collect the writes and flush them
    // with a single saveMany() (one transaction, one refresh). See guideline 36.
    const src = readSource('./notes-sync.service.ts');
    const pullNotes = src.slice(
      src.indexOf('async function pullNotes'),
      src.indexOf('// ── Push helpers')
    );
    // Strip line comments so the assertions check actual calls, not the
    // explanatory comment that names the old `noteStore.save()` trap on purpose.
    const code = pullNotes.replace(/\/\/.*$/gm, '');
    // Writes go through the batched primitive...
    expect(code).toMatch(/noteStore\.saveMany\(/);
    // ...and never per-note save() in the pull loop (the O(n²) refresh trap).
    expect(code).not.toMatch(/noteStore\.save\(/);
    // Tag-association writes are likewise bounded, not a 503-wide burst.
    expect(code).toMatch(/settleInBatches\(\s*tagAdds\b/);
    expect(code).toMatch(/settleInBatches\(\s*tagRemoves\b/);
  });

  it('pullFolders/pullTags/pullSavedSearches batch upserts via saveMany (rule 16)', () => {
    // Same O(n²)-refresh trap as pullNotes above, on the smaller tables: a
    // per-row save() refreshes the whole table on every call inside the
    // Promise.all fan-out. Each helper must buffer its upserts (reconciliation
    // rows ride the same buffer) and flush them with a single saveMany().
    const src = readSource('./notes-sync.service.ts');
    const stripComments = (s: string) => s.replace(/\/\/.*$/gm, '');

    const folders = stripComments(
      src.slice(src.indexOf('async function pullFolders'), src.indexOf('async function pullTags'))
    );
    expect(folders).toMatch(/folderStore\.saveMany\(/);
    // The only per-row save left is the post-sweep parent_id cycle repair,
    // which re-reads the current row and touches at most a few cycle members -
    // the pull fan-out itself must ride the buffer.
    expect(folders.match(/folderStore\.save\(/g) ?? []).toHaveLength(1);
    expect(folders.indexOf('folderStore.save(')).toBeGreaterThan(folders.indexOf('deleteMany'));

    const tags = stripComments(
      src.slice(
        src.indexOf('async function pullTags'),
        src.indexOf('async function pullSavedSearches')
      )
    );
    expect(tags).toMatch(/tagStore\.saveMany\(/);
    expect(tags).not.toMatch(/tagStore\.save\(/);

    const searches = stripComments(
      src.slice(
        src.indexOf('async function pullSavedSearches'),
        src.indexOf('const NOTES_PAGE_SIZE')
      )
    );
    expect(searches).toMatch(/savedSearchStore\.saveMany\(/);
    expect(searches).not.toMatch(/savedSearchStore\.save\(/);
  });

  it('post-pull reconciler runs in +layout.svelte runSync and onMount paths', () => {
    const layout = readSource('../../routes/+layout.svelte');
    expect(layout).toMatch(/from '\$lib\/services\/shadow-index-reconciler\.service'/);
    // Both sync paths (the $effect runSync and the onMount fallback) must call
    // the reconciler when pullFromServer returned synced=true. We check that the
    // reconciler symbol appears at least twice after the pullFromServer wiring.
    const calls = [...layout.matchAll(/verifyAndRebuildLocalShadowIndexes\s*\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('post-reauth path runs the reconciler before refreshing in-memory stores', () => {
    const src = readSource('./notes-auth.service.ts');
    const refresh = src.slice(
      src.indexOf('async function refreshAfterReauth'),
      src.indexOf('export async function reAuthenticate')
    );
    expect(refresh).toMatch(/verifyAndRebuildLocalShadowIndexes/);
    const reconcileIdx = refresh.search(/verifyAndRebuildLocalShadowIndexes\s*\(/);
    const refreshIdx = refresh.search(/refreshStoresAfterPull\s*\(/);
    expect(reconcileIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(reconcileIdx).toBeLessThan(refreshIdx);
  });

  it('refreshStoresAfterPull propagates fresh content to the open note detail view', () => {
    // Without this hop, the sidebar's noteIndex rebuilds with server data but
    // noteDetailService keeps the stale title/content snapshot taken at
    // loadNote() time, so Preview/Edit of the currently open note keeps
    // rendering pre-sync content until the user navigates away and back.
    const src = readSource('./notes-sync.service.ts');
    const refreshFn = src.slice(
      src.indexOf('export async function refreshStoresAfterPull'),
      src.indexOf('// ── Pull sync')
    );
    expect(refreshFn).toMatch(
      /import\s*\(\s*['"]\$lib\/services\/note-detail\.service\.svelte['"]\s*\)/
    );
    expect(refreshFn).toMatch(/noteDetailService\.refreshFromStorage\s*\(/);
  });

  it('noteDetailService.refreshFromStorage guards against clobbering unsaved edits', () => {
    // A pull that lands while the user is mid-edit must NOT overwrite their
    // in-progress title/content - hasPendingChanges() and saveStatus==='saving'
    // both must short-circuit the refresh.
    const src = readSource('./note-detail.service.svelte.ts');
    const methodIdx = src.indexOf('async refreshFromStorage');
    expect(methodIdx).toBeGreaterThan(-1);
    const methodEnd = src.indexOf('\n  }', methodIdx);
    expect(methodEnd).toBeGreaterThan(methodIdx);
    const method = src.slice(methodIdx, methodEnd);
    expect(method).toMatch(/this\.hasPendingChanges\s*\(/);
    expect(method).toMatch(/this\.saveStatus\s*===\s*['"]saving['"]/);
    // No-op when no note is open - guards against unrelated pulls firing the
    // hop after the user closed the editor.
    expect(method).toMatch(/this\.noteId/);
    // No-op when storage returns null (note deleted on another device) -
    // detail view stays put; the deleted note will disappear from the sidebar.
    expect(method).toMatch(/if\s*\(\s*!note\s*\)\s*return/);
  });
});

describe('notes-sync - paginated delta sync (stage 2b)', () => {
  function pullNotesSrc(): string {
    const src = readSource('./notes-sync.service.ts');
    return src.slice(
      src.indexOf('async function pullNotes'),
      src.indexOf('async function writeNotesPage')
    );
  }
  function writeNotesPageSrc(): string {
    const src = readSource('./notes-sync.service.ts');
    return src.slice(
      src.indexOf('async function writeNotesPage'),
      src.indexOf('// ── Push helpers')
    );
  }

  it('pullNotes pages through the server in a cursor loop', () => {
    const code = pullNotesSrc().replace(/\/\/.*$/gm, '');
    // A do/while loop driven by the server's has_more / next_cursor.
    expect(code).toMatch(/do\s*\{/);
    expect(code).toMatch(/while\s*\(\s*cursor\s*\)/);
    expect(code).toMatch(/has_more/);
    expect(code).toMatch(/next_cursor/);
    // The request carries the page limit + cursor.
    expect(code).toMatch(/limit/);
    expect(code).toMatch(/params\.set\(\s*['"]cursor['"]/);
  });

  it('each page is written via saveMany (bounded to a page) and revealed via the index', () => {
    // saveMany lives in the per-page writer; the O(n²) per-note save() trap stays
    // out of both functions.
    const writer = writeNotesPageSrc().replace(/\/\/.*$/gm, '');
    expect(writer).toMatch(/noteStore\.saveMany\(/);
    expect(writer).not.toMatch(/noteStore\.save\(/);
    // The loop reveals each page incrementally without a full rebuild per page.
    const loop = pullNotesSrc().replace(/\/\/.*$/gm, '');
    expect(loop).toMatch(/noteIndex\.upsertFromStore\(/);
    expect(loop).toMatch(/notesStore\.refresh\(/);
    expect(loop).not.toMatch(/noteIndex\.rebuild\(/);
  });

  it('orphan-delete uses the authoritative all_ids only, never page contents', () => {
    const code = pullNotesSrc().replace(/\/\/.*$/gm, '');
    // Deletion is gated on the full id set and skipped when it is absent.
    expect(code).toMatch(/if\s*\(\s*allIds\s*\)/);
    expect(code).toMatch(/!serverIds\.has\(/);
    expect(code).toMatch(/noteStore\.deleteMany\(/);
    // The old "diff against the response body" orphan path must be gone - in
    // delta mode the body is only the changed notes, so it is NOT authoritative.
    expect(code).not.toMatch(/serverNoteIds/);
  });

  it('orphan-delete only sweeps items that were synced BEFORE the pull started', () => {
    // A note created and POSTed while the reconcile pull is paging (live folder
    // sync imports a brand-new file mid-pull) turns 'synced' AFTER the server
    // built all_ids, so it is absent from that set. Sweeping it hard-deleted a
    // note the server has: it resurrected on a later delta while folder sync
    // re-imported its file in the gap - the duplicate-note incident of
    // 2026-07-03. Every pull helper must intersect its sweep with a snapshot
    // of synced ids taken before its first request.
    const code = pullNotesSrc().replace(/\/\/.*$/gm, '');
    // Snapshot is gated to sweep-capable runs and taken before the paging loop.
    expect(code).toMatch(/if\s*\(reconcile \|\| !since\)/);
    expect(code.indexOf('prePullSyncedIds')).toBeGreaterThan(-1);
    expect(code.indexOf('prePullSyncedIds')).toBeLessThan(code.indexOf('do {'));
    // The sweep requires membership in the snapshot, with an empty-set fail-safe.
    expect(code).toMatch(/preSynced\.has\(n\.id\)/);
    expect(code).toMatch(/prePullSyncedIds \?\? new Set/);

    // Same pattern in the three single-request pull helpers.
    const src = readSource('./notes-sync.service.ts').replace(/\/\/.*$/gm, '');
    const helpers = [
      ['async function pullFolders', 'async function pullTags', /prePullSyncedIds\.has\(f\.id\)/],
      [
        'async function pullTags',
        'async function pullSavedSearches',
        /prePullSyncedIds\.has\(t\.id\)/
      ],
      [
        'async function pullSavedSearches',
        'const NOTES_PAGE_SIZE',
        /prePullSyncedIds\.has\(s\.id\)/
      ]
    ] as const;
    for (const [start, end, sweepRe] of helpers) {
      const fn = src.slice(src.indexOf(start), src.indexOf(end));
      // Snapshot precedes the fetch...
      expect(fn.indexOf('prePullSyncedIds')).toBeGreaterThan(-1);
      expect(fn.indexOf('prePullSyncedIds')).toBeLessThan(fn.indexOf('authFetch'));
      // ...and gates the sweep.
      expect(fn).toMatch(sweepRe);
    }
  });

  it('reads the delta watermark behind a count() guard and advances it after the pull', () => {
    const code = pullNotesSrc().replace(/\/\/.*$/gm, '');
    // Ignore a stale watermark when IDB holds no notes (wiped but localStorage
    // survived) -> full pull.
    expect(code).toMatch(/noteStore\.count\(/);
    expect(code).toMatch(/readWatermark\(/);
    expect(code).toMatch(/writeWatermark\(/);
    // The reset helper is exported for the logout path.
    const full = readSource('./notes-sync.service.ts');
    expect(full).toMatch(/export function clearNotesDeltaWatermark\(/);
  });

  it('drives a determinate progress store, cleared in a finally', () => {
    const code = pullNotesSrc();
    expect(code).toMatch(/syncProgress\.set\(\s*\{/); // {done, total}
    expect(code).toMatch(/syncProgress\.set\(\s*null\s*\)/);
    // Orchestrator also clears it as a safety net.
    const run = readSource('./notes-sync.service.ts');
    const runPull = run.slice(
      run.indexOf('async function runPullFromServer'),
      run.indexOf('async function pullFolders')
    );
    expect(runPull).toMatch(/syncProgress\.set\(\s*null\s*\)/);
  });

  it('requests all_ids only on a reconcile pull (variant B gating)', () => {
    const code = pullNotesSrc().replace(/\/\/.*$/gm, '');
    // reconcile decision comes from the session flag, and only the first page
    // asks for it.
    expect(code).toMatch(/const reconcile = !reconciledThisSession/);
    expect(code).toMatch(/reconcile\s*\)\s*params\.set\(\s*['"]reconcile['"]/);
    const full = readSource('./notes-sync.service.ts');
    expect(full).toMatch(/export function requestFullReconcileNextPull\(/);
  });

  it('manual sync and online-recovery force a full reconcile', () => {
    const footer = readSource('../components/sync/SyncStatusFooter.svelte');
    expect(footer).toMatch(/requestFullReconcileNextPull\(\)/);
    const store = readSource('../stores/sync-status.store.ts');
    expect(store).toMatch(/requestFullReconcileNextPull/);
  });

  it('logout clears the delta watermark', () => {
    const authStore = readSource('../stores/auth.store.ts');
    expect(authStore).toMatch(/clearNotesDeltaWatermark\(\)/);
  });

  it('degrades safely against an old server with no page envelope', () => {
    const code = pullNotesSrc().replace(/\/\/.*$/gm, '');
    // When the server returns no `page`, the loop must not crash and must only
    // treat the body as the full id set when there was no `since` (a true bulk).
    expect(code).toMatch(/!pageInfo/);
    expect(code).toMatch(/pageInfo\?\.has_more/);
  });

  it('noteIndex.upsertFromStore updates in-memory by id, not via a full getAll rebuild', () => {
    const src = readSource('./note-index.svelte.ts');
    const method = src.slice(
      src.indexOf('async upsertFromStore'),
      src.indexOf('/** Clear and rebuild')
    );
    expect(method).toMatch(/noteStore\.getMany\(/);
    expect(method).toMatch(/this\._map\.set\(/);
    // Must NOT fall back to the full-table getAll() that build() uses.
    expect(method).not.toMatch(/noteStore\.getAll\(/);
  });
});
