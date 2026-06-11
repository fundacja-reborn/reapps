import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression pins for the saved-searches sync wiring (feat/notes-saved-searches).
 *
 * Source-level checks, same rationale as notes-sync.regression.spec.ts: the
 * sync service pulls in browser-only modules, so asserting on the source is
 * the cheapest way to pin the invariants that keep multi-device convergence:
 * pull guards, push ordering after folders, and the 404-unpark fallback that
 * prevents a dead folder FK from wedging a row in 'pending' forever.
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('saved searches - pull sync', () => {
  const src = readSource('./notes-sync.service.ts');

  it('pullFromServer pulls saved searches alongside folders and tags', () => {
    const pullFn = src.slice(
      src.indexOf('async function runPullFromServer'),
      src.indexOf('async function pullFolders')
    );
    expect(pullFn).toMatch(/pullSavedSearches\(\)/);
  });

  it('pullSavedSearches skips pending rows, reconciles orphaned edits and cleans up server-deleted rows', () => {
    const fn = src.slice(
      src.indexOf('async function pullSavedSearches'),
      src.indexOf('async function pullNotes')
    );
    // Offline edits survive the pull.
    expect(fn).toMatch(/sync_status === 'pending'/);
    // Orphaned-edit reconciliation must compare every pushed field - a missed
    // field means a silently-failed push never retries (guideline 36, rule 9).
    expect(fn).toMatch(/name_encrypted !== s\.name_encrypted/);
    expect(fn).toMatch(/query_encrypted !== s\.query_encrypted/);
    expect(fn).toMatch(/folder_id \?\? null/);
    expect(fn).toMatch(/position !== s\.position/);
    // Rows hard-deleted on another device disappear locally - but only synced ones.
    expect(fn).toMatch(/sync_status === 'synced' && !serverIds\.has/);
    expect(fn).toMatch(/deleteMany\(orphanIds\)/);
  });
});

describe('saved searches - push sync', () => {
  const src = readSource('./notes-sync.service.ts');

  it('pushPendingItems pushes saved searches after the folder layers (FK ordering)', () => {
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );
    expect(fn).toMatch(/pendingSavedSearches\s*=\s*allSavedSearches\.filter/);
    const folderLayersIdx = fn.indexOf('buildFolderLayers');
    const savedSearchPushIdx = fn.search(/pendingSavedSearches\.map/);
    expect(folderLayersIdx).toBeGreaterThan(-1);
    expect(savedSearchPushIdx).toBeGreaterThan(folderLayersIdx);
  });

  it('POST push degrades a dead folder FK to null instead of wedging in pending', () => {
    const fn = src.slice(
      src.indexOf('async function pushSavedSearchPayload'),
      src.indexOf('export function pushSavedSearch')
    );
    expect(fn).toMatch(/res\.status === 404 && payload\.folder_id/);
    expect(fn).toMatch(/folder_id:\s*null/);
    // The local row must mirror the unparking, otherwise the dirty-compare
    // re-flags it and the dead FK is re-sent forever.
    expect(fn).toMatch(/unparked/);
  });

  it('PATCH push distinguishes "folder gone" (unpark) from "search not on server" (throw)', () => {
    const fn = src.slice(
      src.indexOf('export function pushSavedSearchUpdate'),
      src.indexOf('export function pushSavedSearchDelete')
    );
    expect(fn).toMatch(/res\.status === 404 && fields\.folder_id/);
    expect(fn).toMatch(/Folder not found/);
    expect(fn).toMatch(/throw new Error\(`PATCH \/api\/saved-searches/);
  });

  it('pushSavedSearchDelete does not clobber sync_version (same bug class as folders/tags)', () => {
    const fn = src.slice(src.indexOf('export function pushSavedSearchDelete'));
    expect(fn).not.toMatch(/sync_version:\s*1\b/);
  });
});

describe('saved searches - folder delete unparks', () => {
  it('deleteFolder unparks searches from the folder and its descendants before deleting', () => {
    const src = readSource('./folder.service.ts');
    const fn = src.slice(
      src.indexOf('export async function deleteFolder'),
      src.indexOf('export async function moveFolderToParent')
    );
    // Unpark must run for every folder in the deleted subtree.
    expect(fn).toMatch(/savedSearchStore\.query\('folder_id', fid\)/);
    expect(fn).toMatch(/pushSavedSearchUpdate\([^)]*\{ folder_id: null \}\)/);
    // And it must happen BEFORE the bottom-up folder deletes.
    const unparkIdx = fn.indexOf('savedSearchStore.query');
    const deleteIdx = fn.indexOf('folderIds.slice(1).reverse()');
    expect(unparkIdx).toBeGreaterThan(-1);
    expect(unparkIdx).toBeLessThan(deleteIdx);
  });
});

describe('saved searches - API endpoints', () => {
  it('DELETE is idempotent: missing or foreign rows return success, not 404', () => {
    const src = readFileSync(
      resolve(__dirname, '../../routes/api/saved-searches/[id]/+server.ts'),
      'utf-8'
    );
    const handler = src.slice(src.indexOf('export const DELETE'));
    expect(handler).toMatch(/if \(!existing\) return json\(\{ success: true \}\)/);
  });

  it('POST and PATCH validate folder ownership and answer 404 for a dead FK', () => {
    const postSrc = readFileSync(
      resolve(__dirname, '../../routes/api/saved-searches/+server.ts'),
      'utf-8'
    );
    const patchSrc = readFileSync(
      resolve(__dirname, '../../routes/api/saved-searches/[id]/+server.ts'),
      'utf-8'
    );
    for (const src of [postSrc, patchSrc]) {
      expect(src).toMatch(/prisma\.folder\.findFirst/);
      expect(src).toMatch(/user_id: userId/);
      expect(src).toMatch(/'Folder not found' \}, \{ status: 404 \}/);
    }
  });

  it('PATCH bumps sync_version on every update', () => {
    const src = readFileSync(
      resolve(__dirname, '../../routes/api/saved-searches/[id]/+server.ts'),
      'utf-8'
    );
    expect(src).toMatch(/sync_version: existing\.sync_version \+ 1/);
  });
});
