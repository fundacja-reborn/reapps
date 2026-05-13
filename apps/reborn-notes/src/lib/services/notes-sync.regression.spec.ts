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

  it('delete/restore push ops are serialized per-entity (BUG-5 part A/B/C)', () => {
    const src = readSource('./notes-sync.service.ts');

    // The helper itself must exist.
    expect(src).toMatch(/function\s+serializePerEntity\s*</);

    // Every push* that mutates a single (type, id) must route through it,
    // otherwise the network can reorder the wire and diverge server vs local.
    const mustSerialize: Array<[RegExp, 'note' | 'folder' | 'tag']> = [
      [/export function pushNote\b/, 'note'],
      [/export function pushNoteUpdate\b/, 'note'],
      [/export function pushNoteDelete\b/, 'note'],
      [/export function pushNoteRestore\b/, 'note'],
      [/export function pushFolder\b/, 'folder'],
      [/export function pushFolderUpdate\b/, 'folder'],
      [/export function pushFolderDelete\b/, 'folder'],
      [/export function pushTag\b/, 'tag'],
      [/export function pushTagUpdate\b/, 'tag'],
      [/export function pushTagDelete\b/, 'tag']
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

  it('pushNoteDelete and pushNoteRestore mirror server sync_version locally (BUG-6)', () => {
    const src = readSource('./notes-sync.service.ts');

    const deleteBody = src.slice(
      src.indexOf('export function pushNoteDelete'),
      src.indexOf('export function pushNoteRestore')
    );
    // Must parse the response body and extract sync_version.
    expect(deleteBody).toMatch(/await res\.json\(\)/);
    expect(deleteBody).toMatch(/data\?\.sync_version/);
    // And apply it in noteStore.save under serverSyncVersion.
    expect(deleteBody).toMatch(/sync_version:\s*serverSyncVersion/);

    const restoreBody = src.slice(
      src.indexOf('export function pushNoteRestore'),
      src.indexOf('export function pushFolder')
    );
    expect(restoreBody).toMatch(/await res\.json\(\)/);
    expect(restoreBody).toMatch(/data\?\.sync_version/);
    expect(restoreBody).toMatch(/sync_version:\s*serverSyncVersion/);
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

  it('pushPendingItems pushes folders BFS-by-layer (parent before child)', () => {
    // Server's POST /api/folders FK-checks parent_id and 404s if the parent
    // isn't on the server yet. Flat Promise.allSettled would 404-spam mid-batch
    // on nested vault imports - pushPendingItems must use buildFolderLayers
    // and await each layer before starting the next.
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );

    // Must consume the layered helper.
    expect(fn).toMatch(/buildFolderLayers\s*\(\s*pendingFolders\s*\)/);

    // The folder push must live inside `for (const layer of …)` with an
    // `await Promise.allSettled` per iteration. Loose match: `for` block
    // appears, and within the file, the `/api/folders` POST is reachable
    // only through that loop.
    expect(fn).toMatch(/for\s*\(\s*const\s+layer\s+of\s+buildFolderLayers/);

    // Sanity: the old flat folder-and-tag combined Promise.allSettled is gone.
    // (If both were in one settle, layering wouldn't matter.)
    const foldersPostIdx = fn.indexOf("'/api/folders'") >= 0
      ? fn.indexOf("'/api/folders'")
      : fn.indexOf('/api/folders');
    const tagsPostIdx = fn.indexOf("'/api/tags'") >= 0
      ? fn.indexOf("'/api/tags'")
      : fn.indexOf('/api/tags');
    expect(foldersPostIdx).toBeGreaterThan(-1);
    expect(tagsPostIdx).toBeGreaterThan(-1);
    // Between folders POST and tags POST there must be a `})` closing the
    // folder for-loop, then a fresh `await Promise.allSettled` for tags.
    const between = fn.slice(foldersPostIdx, tagsPostIdx);
    expect(between).toMatch(/await\s+Promise\.allSettled/);
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

    expect(helpers).toMatch(
      /FolderService\.createFolder\([^)]*\{\s*skipSync:\s*true\s*\}\s*\)/
    );
    expect(helpers).toMatch(
      /TagService\.createTag\([^)]*\{\s*skipSync:\s*true\s*\}\s*\)/
    );

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

    const folderLoopStart = src.indexOf("for (const folder of backupData.folders");
    const folderSafeParseIdx = src.indexOf('FolderEncryptedSchema.safeParse', folderLoopStart);
    expect(folderSafeParseIdx).toBeGreaterThan(folderLoopStart);
    const folderPreValidate = src.slice(folderLoopStart, folderSafeParseIdx);
    expect(folderPreValidate).toMatch(/normalized\.user_id\s*=\s*userId/);

    const tagLoopStart = src.indexOf("for (const tag of backupData.tags");
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
      // Bail out when userId is absent.
      expect(body, `${fnName} must early-return on missing userId`).toMatch(
        /if\s*\(\s*!userId\s*\)\s*return\s*;/
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
    expect(cleanupSrc).not.toMatch(/^const\s+FLAG_KEY\s*=\s*'reborn-notes:idb-null-fk-cleanup-v1'/m);
  });

  it('export sanitizer stamps current userId into records with invalid user_id', () => {
    // normalizeExportUuids gets a userIdReplacement parameter; both
    // exportJsonBackup and exportEncryptedBackup must pass the current
    // account's userId so legacy IDB pollution (user_id: null/missing)
    // doesn't propagate into freshly-emitted backup files.
    const src = readSource('./export-import.service.ts');
    expect(src).toMatch(
      /function\s+normalizeExportUuids[\s\S]{0,300}?userIdReplacement\?:\s*string/
    );

    const fullExport = src.slice(
      src.indexOf('export async function exportJsonBackup'),
      src.indexOf('export async function exportEncryptedBackup')
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
      expect(argList, `normalizeExportUuids call must thread userId: ${argList}`).toMatch(
        /userId/
      );
    }

    const encExport = src.slice(src.indexOf('export async function exportEncryptedBackup'));
    expect(encExport).toMatch(/get\(authStore\)\.userId/);
    for (const argList of eachCall(encExport, 'normalizeExportUuids')) {
      expect(argList, `normalizeExportUuids call must thread userId: ${argList}`).toMatch(
        /userId/
      );
    }
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
    const window = pullNotes.slice(callMatch!.index, callMatch!.index + 600);
    expect(window).toMatch(/catch\s*\(/);
    expect(window).toMatch(/return;/);
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
