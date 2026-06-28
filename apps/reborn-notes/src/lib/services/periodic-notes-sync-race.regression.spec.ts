import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression for the periodic-note duplicate introduced by the paginated delta
 * sync (PR #356).
 *
 * `findExistingPeriodicNote` resolves against the in-memory `noteIndex`, which
 * the paginated pull builds up one page at a time. The keyset order
 * (`updated_at ASC`) puts today's freshly-touched periodic note on the LAST
 * page, while the first-load placeholder drops after page 1 - so opening the
 * daily/weekly/monthly note during the pull window used to miss the note that
 * was simply not paged in yet and create a duplicate of it.
 *
 * The fix gates `getOrCreateNote` over TWO windows:
 *   1. A pull is in flight (`isSyncing`): wait for it to settle (the flag clears
 *      in the pull's `finally`, after the last page is upserted), then resolve.
 *   2. Cold login, pre-pull window (`lastSyncedAt === null`, not local-only, no
 *      pull in flight yet but one imminent): the layout's runSync does a settings
 *      round-trip + push BEFORE pulling, so `isSyncing` is still false. Ensure a
 *      pull completes first via the single-flight `pullFromServer` (joins the
 *      imminent/in-flight pull, no extra round-trip), then resolve.
 *
 * THIRD window (smoke 2026-06-28): the duplicate reproduced "directly after
 * Synced", with isSyncing false AND lastSyncedAt non-null - so neither gate
 * window was open. Root cause was not in the resolver but in
 * `noteIndex.rebuild()`: it did `this._map.clear()` before an async `build()`
 * that yields between decrypt batches, leaving the index observably EMPTY for the
 * whole rebuild. `refreshStoresAfterPull` runs that rebuild right after the pull
 * flips lastSyncedAt -> "Synced", so a periodic-note open in the gap saw zero
 * notes and duplicated today's note. The structural fix is in note-index.svelte.ts:
 * rebuild() must delegate to build() (atomic Map swap) and never pre-clear.
 *
 * FOURTH window (smoke 2026-06-28, the real one): what was duplicating was not the
 * NOTE but the FOLDER. `getOrCreateNote` ran `ensureFolder` BEFORE the gate, and
 * `ensureFolder` resolves the periodic folder against the in-memory `foldersStore`
 * - which a cold login leaves EMPTY (logout clears IndexedDB *and* settings; the
 * pull writes folders to IndexedDB but does NOT refresh the in-memory foldersStore
 * until refreshStoresAfterPull, AFTER the pull). So a click mid-pull saw no folder,
 * minted a DUPLICATE one, persisted it as settings.folderId, and the note landed
 * there - which also defeats post-sync note-dedup (it groups by folderId). The fix
 * moves the gate to the TOP of getOrCreateNote (before ensureFolder) and refreshes
 * foldersStore from the now-complete IndexedDB once the pull settles, so the folder
 * is resolved against real data. The first test block below pins this ordering;
 * the second pins the atomic rebuild.
 *
 * Source-level, like notes-sync.regression.spec.ts: periodic-notes.service pulls
 * in browser-only modules (cryptoManager, reactive stores) that are impractical
 * to wire up in a Node test env. The wait primitive itself is unit-tested in
 * store-wait.spec.ts.
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

function getOrCreateNoteBody(): string {
  const src = readSource('./periodic-notes.service.ts');
  const start = src.indexOf('export async function getOrCreateNote');
  expect(start).toBeGreaterThan(-1);
  // getOrCreateNote is the last export in the file; slice to EOF is fine, but
  // bound it defensively at the next top-level `export ` if one is ever added.
  const after = src.slice(start + 1);
  const nextExportIdx = after.indexOf('\nexport ');
  const end = nextExportIdx > -1 ? start + 1 + nextExportIdx : src.length;
  return src.slice(start, end);
}

describe('periodic notes - resolver/sync race (PR #356 regression)', () => {
  it('imports the sync-state flags and the wait primitive', () => {
    const src = readSource('./periodic-notes.service.ts');
    // isSyncing (in-flight), lastSyncedAt + localOnly (cold pre-pull window).
    expect(src).toMatch(
      /import\s*\{[^}]*\bisSyncing\b[^}]*\blastSyncedAt\b[^}]*\blocalOnly\b[^}]*\}\s*from\s*'\$lib\/stores\/sync-status\.store'/s
    );
    expect(src).toMatch(/import\s*\{\s*whenFalsy\s*\}\s*from\s*'\$lib\/utils\/store-wait'/);
  });

  it('window 1: waits for an in-flight pull, gated on isSyncing so steady-state clicks never block', () => {
    const body = getOrCreateNoteBody();
    // The whenFalsy await must sit inside an `if (get(isSyncing))` block, not run
    // unconditionally (which would couple every click to a redundant re-resolve).
    const guardIdx = body.search(/if\s*\(\s*get\(\s*isSyncing\s*\)\s*\)/);
    const waitIdx = body.search(/await\s+whenFalsy\(\s*isSyncing\s*\)/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(waitIdx).toBeGreaterThan(guardIdx);
  });

  it('window 2: on a cold first sync (lastSyncedAt null, not local-only) it awaits a pull before creating', () => {
    const body = getOrCreateNoteBody();
    // Must gate on the cold-first-sync condition...
    expect(body).toMatch(/!get\(\s*localOnly\s*\)/);
    expect(body).toMatch(/get\(\s*lastSyncedAt\s*\)\s*===\s*null/);
    // ...and ensure a pull settles (single-flight join), not just probe a flag.
    expect(body).toMatch(/await\s+import\(\s*'\$lib\/services\/notes-sync\.service'\s*\)/);
    expect(body).toMatch(/await\s+pullFromServer\(\)/);
  });

  it('gates BEFORE resolving the folder: ensureFolder runs after both settle windows', () => {
    const body = getOrCreateNoteBody();
    const inFlightWait = body.search(/await\s+whenFalsy\(\s*isSyncing\s*\)/);
    const coldWait = body.search(/await\s+pullFromServer\(\)/);
    const ensureIdx = body.indexOf('ensureFolder(');
    expect(inFlightWait).toBeGreaterThan(-1);
    expect(coldWait).toBeGreaterThan(-1);
    expect(ensureIdx).toBeGreaterThan(-1);
    // ensureFolder() CREATES a folder when it can't find one, so it must not run
    // until the pull has settled - otherwise it resolves against the empty
    // pre-pull foldersStore and mints a duplicate periodic folder (the 2026-06-28
    // bug). Both settle windows therefore precede it in source order.
    expect(ensureIdx).toBeGreaterThan(inFlightWait);
    expect(ensureIdx).toBeGreaterThan(coldWait);
  });

  it('refreshes foldersStore after settling and before ensureFolder', () => {
    const body = getOrCreateNoteBody();
    const refreshIdx = body.search(/await\s+foldersStore\.refresh\(\)/);
    const lastWait = Math.max(
      body.search(/await\s+whenFalsy\(\s*isSyncing\s*\)/),
      body.search(/await\s+pullFromServer\(\)/)
    );
    const ensureIdx = body.indexOf('ensureFolder(');
    // The pull writes folders to IndexedDB but does NOT refresh the in-memory
    // foldersStore; without this explicit refresh ensureFolder would still read
    // the empty pre-pull snapshot. Refresh sits after the waits, before resolve.
    expect(refreshIdx).toBeGreaterThan(lastWait);
    expect(ensureIdx).toBeGreaterThan(refreshIdx);
  });

  it('resolves the note and creates only after the folder is resolved', () => {
    const body = getOrCreateNoteBody();
    // Match the CALLS (trailing paren) so the doc-comment mentions of these names
    // don't register as earlier occurrences.
    const ensureIdx = body.indexOf('ensureFolder(');
    const resolveIdx = body.indexOf('findExistingPeriodicNote(');
    const createIdx = body.indexOf('createNote(');
    expect(resolveIdx).toBeGreaterThan(ensureIdx);
    expect(createIdx).toBeGreaterThan(resolveIdx);
  });
});

describe('noteIndex.rebuild - atomic swap (post-pull empty-window regression)', () => {
  function rebuildBody(): string {
    const src = readSource('./note-index.svelte.ts');
    const start = src.indexOf('async rebuild(');
    expect(start).toBeGreaterThan(-1);
    // rebuild() is a short method; bound the slice at the next method's closing
    // by taking up to the following `  /** ` doc-comment or `  clear(` sibling.
    const after = src.slice(start);
    const end = after.search(/\n\s{2}(?:\/\*\*|clear\(|update\()/);
    return end > -1 ? after.slice(0, end) : after.slice(0, 400);
  }

  it('rebuild() delegates to build() and never pre-clears the live map', () => {
    const body = rebuildBody();
    // build() fills a fresh Map and swaps it into this._map only at the end, so
    // the old complete map must stay readable until the swap. A pre-clear here
    // (this._map.clear()) reopens the post-"Synced" empty window that duplicated
    // periodic notes - it must be gone.
    expect(body).toMatch(/await\s+this\.build\(\)/);
    expect(body).not.toMatch(/this\._map\.clear\(\)/);
  });

  it('build() itself swaps a freshly-built map in atomically (single assignment)', () => {
    const src = readSource('./note-index.svelte.ts');
    const start = src.indexOf('async build(');
    // Bound the slice at the next method (upsertFromStore) so we read exactly
    // build()'s body, not a fixed char window that could clip the final swap.
    const end = src.indexOf('async upsertFromStore(', start);
    const body = src.slice(start, end > -1 ? end : start + 2400);
    // The atomicity contract rebuild() relies on: build() works on a LOCAL `map`
    // and publishes it with one `this._map = map`, rather than mutating this._map
    // incrementally (which would expose partial state mid-build).
    expect(body).toMatch(/const\s+map\s*=\s*new\s+Map/);
    expect(body).toMatch(/this\._map\s*=\s*map/);
  });
});
