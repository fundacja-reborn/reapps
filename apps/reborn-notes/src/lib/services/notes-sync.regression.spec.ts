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
    const onlineHandler = src.slice(
      src.indexOf("addEventListener('online'"),
      src.indexOf("addEventListener('offline'")
    );
    // Look only at CALL sites, not the destructuring import (which lists names
    // in arbitrary order).
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
});
