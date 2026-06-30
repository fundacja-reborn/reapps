import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: the pre-edit baseline must enter version history.
 *
 * `updateNote` overwrites the note's ciphertext in IndexedDB in place, and
 * `saveVersionSnapshot` copies whatever is CURRENTLY in IDB. Every snapshot
 * trigger (note switch, history-panel open, 30-min checkpoint) fires only AFTER
 * the debounced save has already overwritten the loaded content - so the first
 * edit of a freshly-loaded note used to erase its pristine state from history
 * (the edit looked like version 1, the original was gone). Lazy version history
 * (PR #355) removed the sync-time backfill that previously masked this.
 *
 * The fix snapshots the pristine state on the FIRST edit, before the debounced
 * save runs. Source-level, like notes-sync.regression.spec.ts: the service
 * imports browser-only modules (IndexedDB stores, i18n) that are impractical to
 * wire up in a Node test env.
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

function noteDetailSrc(): string {
  return readSource('./note-detail.service.svelte.ts');
}

function sliceMethod(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, `method not found: ${header}`).toBeGreaterThan(-1);
  // Methods are indented one level; the next `\n  }` closes this one.
  const end = src.indexOf('\n  }', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('note version history - pre-edit baseline (PR #355 regression)', () => {
  it('tracks a per-load baselineCaptured flag', () => {
    expect(noteDetailSrc()).toMatch(/private\s+baselineCaptured\s*=\s*false/);
  });

  it('captureBaselineSnapshot fires once per load via the server-reconciling baseline path', () => {
    const method = sliceMethod(noteDetailSrc(), 'private captureBaselineSnapshot');
    // Idempotent guard: bail when already captured this load.
    expect(method).toMatch(/if\s*\(\s*this\.baselineCaptured\s*\)\s*return/);
    // Needs an open note.
    expect(method).toMatch(/this\.noteId/);
    // Flip the flag BEFORE the async snapshot so re-entrant edits don't double up.
    const setFlagIdx = method.search(/this\.baselineCaptured\s*=\s*true/);
    // MUST route through saveBaselineSnapshot (server-reconciling), NOT the bare
    // saveVersionSnapshot - the latter dedups only against (lazy, often-empty)
    // local history and would duplicate an existing server version.
    const snapshotIdx = method.search(/saveBaselineSnapshot\s*\(/);
    expect(setFlagIdx).toBeGreaterThan(-1);
    expect(snapshotIdx).toBeGreaterThan(setFlagIdx);
    expect(method).not.toMatch(/saveVersionSnapshot\s*\(/);
  });

  it('both debounced setters capture the baseline before scheduling the save', () => {
    const src = noteDetailSrc();
    for (const header of ['setTitleDebounced(title: string)', 'setContentDebounced(content: string)']) {
      const method = sliceMethod(src, header);
      const captureIdx = method.search(/this\.captureBaselineSnapshot\s*\(\s*\)/);
      const scheduleIdx = method.search(/setTimeout\s*\(/);
      expect(captureIdx, `${header} must call captureBaselineSnapshot`).toBeGreaterThan(-1);
      // The capture (which reads pristine IDB) must happen before the debounced
      // save (which overwrites it) is even scheduled.
      expect(scheduleIdx).toBeGreaterThan(captureIdx);
    }
  });

  it('loadNote resets the baseline flag so each opened note gets its own baseline', () => {
    const method = sliceMethod(noteDetailSrc(), 'async loadNote(id: string)');
    expect(method).toMatch(/this\.baselineCaptured\s*=\s*false/);
  });

  it('reset clears the baseline flag', () => {
    const method = sliceMethod(noteDetailSrc(), 'reset(): void');
    expect(method).toMatch(/this\.baselineCaptured\s*=\s*false/);
  });
});

/**
 * The duplicate-baseline follow-up (smoke 2026-06-27, Pixel 7): the baseline
 * was written against the lazy/empty local history and duplicated a server
 * version pulled later. saveBaselineSnapshot reconciles with the server first;
 * serializeVersionWrite closes the non-atomic read-then-write race shared by all
 * snapshot triggers.
 */
function noteServiceSrc(): string {
  return readSource('./note.service.ts');
}

function sliceServiceFn(src: string, header: string, until: string): string {
  const start = src.indexOf(header);
  expect(start, `fn not found: ${header}`).toBeGreaterThan(-1);
  const end = src.indexOf(until, start + header.length);
  expect(end, `end not found after ${header}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('note version history - baseline server-reconcile + write serialization', () => {
  it('saveBaselineSnapshot pulls server history BEFORE the dedup, then skips an already-versioned state', () => {
    const fn = sliceServiceFn(
      noteServiceSrc(),
      'export async function saveBaselineSnapshot',
      '\nexport '
    );
    // Pristine entry captured up front (before any await that could race the save).
    const getIdx = fn.search(/noteStore\.get\(/);
    const syncIdx = fn.search(/syncNoteVersionsFromServer\s*\(/);
    const dedupIdx = fn.search(/\.some\(/);
    const writeIdx = fn.search(/saveVersion\s*\(/);
    expect(getIdx).toBeGreaterThan(-1);
    // Server pull happens, and BEFORE the dedup that decides whether to write.
    expect(syncIdx).toBeGreaterThan(getIdx);
    expect(dedupIdx).toBeGreaterThan(syncIdx);
    // Dedup compares ciphertext of the pristine entry against existing versions.
    expect(fn).toMatch(/v\.title_encrypted\s*===\s*entry\.title_encrypted/);
    expect(fn).toMatch(/v\.content_encrypted\s*===\s*entry\.content_encrypted/);
    // Skips when already versioned; only writes otherwise.
    expect(fn).toMatch(/if\s*\(\s*alreadyVersioned\s*\)\s*return/);
    expect(writeIdx).toBeGreaterThan(dedupIdx);
    // created_at is the pristine note's updated_at (so it sorts as the OLDER state).
    expect(fn).toMatch(/created_at:\s*entry\.updated_at/);
  });

  it('both snapshot writers run inside the per-note serialize chain', () => {
    const src = noteServiceSrc();
    expect(src).toMatch(/function\s+serializeVersionWrite\s*</);
    const save = sliceServiceFn(src, 'export async function saveVersionSnapshot', '\nexport ');
    const baseline = sliceServiceFn(src, 'export async function saveBaselineSnapshot', '\nexport ');
    expect(save).toMatch(/serializeVersionWrite\(\s*noteId\s*,/);
    expect(baseline).toMatch(/serializeVersionWrite\(\s*noteId\s*,/);
  });
});

/**
 * Regression: a brand-new note is created lazily on its first edit (#349), so it
 * has no server row until the debounced save POSTs it to /api/notes. The version
 * paths target /api/notes/{id}/versions, which 404s while the parent note is
 * missing - producing a swallowed GET 404 plus three doomed POST retries on the
 * first keystroke of every new note. Two guards keep version sync from running
 * before the note exists on the server:
 *   1. saveBaselineSnapshot bails on an ephemeral note (its pristine state is an
 *      empty blank - no baseline worth keeping, and the note has no server row).
 *   2. pushNoteVersion runs inside the note's per-entity chain, so it queues
 *      behind any in-flight create/update instead of overtaking it (closes the
 *      leave-immediately-after-first-edit race where the note is promoted but its
 *      POST /api/notes is still in flight).
 */
function notesSyncSrc(): string {
  return readSource('./notes-sync.service.ts');
}

describe('note version history - no version push before the note exists on the server', () => {
  it('saveBaselineSnapshot bails on an ephemeral (not-yet-created) note before any server contact', () => {
    const fn = sliceServiceFn(
      noteServiceSrc(),
      'export async function saveBaselineSnapshot',
      '\nexport '
    );
    const ephemeralGuardIdx = fn.search(/if\s*\(\s*entry\.is_ephemeral\s*\)\s*return/);
    expect(ephemeralGuardIdx, 'must skip ephemeral notes').toBeGreaterThan(-1);
    // The guard precedes BOTH the server-history pull and the version write/push,
    // so a not-yet-created note makes zero /versions requests.
    const realSyncCall = fn.search(/await\s+syncNoteVersionsFromServer\s*\(/);
    const writeIdx = fn.search(/saveVersion\s*\(/);
    expect(realSyncCall).toBeGreaterThan(ephemeralGuardIdx);
    expect(writeIdx).toBeGreaterThan(ephemeralGuardIdx);
  });

  it('pushNoteVersion is serialized through the note per-entity chain, not a bare pushSilently', () => {
    const fn = sliceServiceFn(notesSyncSrc(), 'export function pushNoteVersion', '\nexport ');
    // Must enter the same FIFO as pushNote/pushNoteUpdate, keyed by the parent note,
    // so the version push waits for an in-flight create/update to finish.
    expect(fn).toMatch(/serializePerEntity\(\s*'note'\s*,\s*entry\.note_id\s*,/);
    // The upload still runs through pushSilently (retry/backoff) INSIDE the chain.
    const chainIdx = fn.search(/serializePerEntity\(/);
    const silentIdx = fn.search(/pushSilently\(/);
    expect(chainIdx).toBeGreaterThan(-1);
    expect(silentIdx).toBeGreaterThan(chainIdx);
  });
});
