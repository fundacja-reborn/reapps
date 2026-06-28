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
 *      in the pull's `finally`, after the last page is upserted), then re-resolve.
 *   2. Cold login, pre-pull window (`lastSyncedAt === null`, not local-only, no
 *      pull in flight yet but one imminent): the layout's runSync does a settings
 *      round-trip + push BEFORE pulling, so `isSyncing` is still false. Ensure a
 *      pull completes first via the single-flight `pullFromServer` (joins the
 *      imminent/in-flight pull, no extra round-trip), then re-resolve.
 * Only after both windows still miss do we create. The smoke repro was exactly
 * window 2: logging in and opening the daily note immediately, before the new
 * session's pull had paged today's note in.
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

  it('both windows re-resolve against the index AFTER settling and create only if still absent', () => {
    const body = getOrCreateNoteBody();

    const firstResolve = body.indexOf('findExistingPeriodicNote');
    // The gate settles via either window before the second resolve.
    const inFlightWait = body.search(/await\s+whenFalsy\(\s*isSyncing\s*\)/);
    const coldWait = body.search(/await\s+pullFromServer\(\)/);
    const createIdx = body.indexOf('createNote(');
    // The re-resolve sits after BOTH window awaits (it's guarded by a `settled`
    // flag set in either branch), and before create.
    const lastWait = Math.max(inFlightWait, coldWait);
    const secondResolve = body.indexOf('findExistingPeriodicNote', lastWait);

    expect(firstResolve).toBeGreaterThan(-1);
    expect(inFlightWait).toBeGreaterThan(firstResolve);
    expect(coldWait).toBeGreaterThan(firstResolve);
    expect(secondResolve).toBeGreaterThan(lastWait);
    expect(createIdx).toBeGreaterThan(secondResolve);
  });
});
