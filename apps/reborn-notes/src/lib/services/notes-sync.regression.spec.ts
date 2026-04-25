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

describe('notes-sync — regression (offline data loss)', () => {
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
      // Scan only the next ~600 chars — long enough for the wrapper, short
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
    // on nested vault imports — pushPendingItems must use buildFolderLayers
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

    // No direct pushNote/pushFolder/pushTag calls inside importFolder —
    // pushPendingItems() is the single push path so order is enforced.
    const importFolder = src.slice(importFolderStart);
    expect(importFolder).not.toMatch(/\bpushNote\s*\(/);
    expect(importFolder).not.toMatch(/\bpushFolder\s*\(/);
    expect(importFolder).not.toMatch(/\bpushTag\s*\(/);
    expect(importFolder).toMatch(/pushPendingItems\s*\(/);
  });
});
