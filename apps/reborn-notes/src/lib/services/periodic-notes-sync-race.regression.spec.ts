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
 * page, while the first-load placeholder drops after page 1 - so a click on the
 * daily/weekly/monthly button during the pull window used to miss the note that
 * was simply not paged in yet and create a duplicate of it.
 *
 * The fix gates `getOrCreateNote`: on an index miss WITH a pull in flight, wait
 * for the pull to settle (index complete) and resolve once more before creating.
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
  it('imports the in-flight-sync flag and the wait primitive', () => {
    const src = readSource('./periodic-notes.service.ts');
    expect(src).toMatch(/import\s*\{\s*isSyncing\s*\}\s*from\s*'\$lib\/stores\/sync-status\.store'/);
    expect(src).toMatch(/import\s*\{\s*whenFalsy\s*\}\s*from\s*'\$lib\/utils\/store-wait'/);
  });

  it('getOrCreateNote waits for an in-flight pull before creating, then re-resolves', () => {
    const body = getOrCreateNoteBody();

    // Must consult the in-flight flag and await the settle primitive.
    expect(body).toMatch(/get\(\s*isSyncing\s*\)/);
    expect(body).toMatch(/await\s+whenFalsy\(\s*isSyncing\s*\)/);

    // Ordering: initial resolve → gate (await whenFalsy) → re-resolve → create.
    const firstResolve = body.indexOf('findExistingPeriodicNote');
    const waitIdx = body.search(/await\s+whenFalsy\(\s*isSyncing\s*\)/);
    const secondResolve = body.indexOf('findExistingPeriodicNote', waitIdx);
    const createIdx = body.indexOf('createNote(');

    expect(firstResolve).toBeGreaterThan(-1);
    expect(waitIdx).toBeGreaterThan(firstResolve);
    // A second resolve happens AFTER the wait...
    expect(secondResolve).toBeGreaterThan(waitIdx);
    // ...and the actual create happens only after that re-resolve.
    expect(createIdx).toBeGreaterThan(secondResolve);
  });

  it('the wait is gated on isSyncing so steady-state clicks never block', () => {
    const body = getOrCreateNoteBody();
    // The whenFalsy await must sit inside an `if (get(isSyncing))` block, not
    // run unconditionally (which would couple every click to a store read +
    // redundant re-resolve even when nothing is syncing).
    const guardIdx = body.search(/if\s*\(\s*get\(\s*isSyncing\s*\)\s*\)/);
    const waitIdx = body.search(/await\s+whenFalsy\(\s*isSyncing\s*\)/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(waitIdx).toBeGreaterThan(guardIdx);
  });
});
