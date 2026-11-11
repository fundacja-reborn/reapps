import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Deleting version history (#521) - the orderings that keep a delete from
 * quietly coming back. Source-level, like note-version-baseline.regression.spec:
 * the services import browser-only modules (IndexedDB stores, crypto, i18n).
 * The pure reconcile decision has its own behavioural spec
 * (version-reconcile.spec.ts).
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

function sliceFn(src: string, header: string, until = '\nexport '): string {
  const start = src.indexOf(header);
  expect(start, `fn not found: ${header}`).toBeGreaterThan(-1);
  const end = src.indexOf(until, start + header.length);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

describe('note.service - delete local first, then server, roll back on failure', () => {
  const src = readSource('./note.service.ts');

  for (const [header, localOp, serverOp, rollback] of [
    [
      'export async function deleteNoteVersion(',
      'noteHistoryOperations.deleteVersion(',
      'deleteNoteVersionOnServer(',
      'noteHistoryStore.save(removed)'
    ],
    [
      'export async function clearNoteHistory(',
      'noteHistoryOperations.clearForNote(',
      'clearNoteVersionsOnServer(',
      'noteHistoryStore.saveMany(removed)'
    ]
  ] as const) {
    it(`${header.slice(22, -1)}: offline check, local delete, server delete, rollback`, () => {
      const fn = sliceFn(src, header);
      const guardIdx = fn.indexOf('assertCanDeleteHistory()');
      const localIdx = fn.indexOf(localOp);
      const serverIdx = fn.indexOf(serverOp);
      const catchIdx = fn.indexOf('catch (err)');
      const rollbackIdx = fn.indexOf(rollback);
      expect(guardIdx).toBeGreaterThan(-1);
      // Local first: an in-flight version POST then finds its row gone and
      // reaps the version on the server (markVersionSyncedOrReap).
      expect(localIdx).toBeGreaterThan(guardIdx);
      expect(serverIdx).toBeGreaterThan(localIdx);
      // A failed server delete puts the rows back and re-throws for the UI.
      expect(catchIdx).toBeGreaterThan(serverIdx);
      expect(rollbackIdx).toBeGreaterThan(catchIdx);
      expect(fn.slice(rollbackIdx)).toMatch(/throw err/);
      // Serialized with the snapshot writes for the same note.
      expect(fn).toMatch(/serializeVersionWrite\(noteId/);
    });
  }

  it('clearAllNoteHistory: offline check, then local clear, then server', () => {
    const fn = sliceFn(src, 'export async function clearAllNoteHistory(');
    const guardIdx = fn.indexOf('assertCanDeleteHistory()');
    const localIdx = fn.indexOf('noteHistoryOperations.clearAll()');
    const serverIdx = fn.indexOf('clearAllVersionsOnServer()');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(localIdx).toBeGreaterThan(guardIdx);
    expect(serverIdx).toBeGreaterThan(localIdx);
  });

  it('a signed-in user offline gets HistoryDeleteOfflineError (no local-only delete)', () => {
    const fn = sliceFn(src, 'function assertCanDeleteHistory', '\n}');
    expect(fn).toMatch(/historyDeletesNeedServer\(\)\s*&&\s*!checkOnline\(\)/);
    expect(fn).toMatch(/throw new HistoryDeleteOfflineError\(\)/);
  });
});

describe('notes-sync.service - version deletes reach other devices and survive races', () => {
  const src = readSource('./notes-sync.service.ts');

  it('pullNoteVersionsForNote reads local rows BEFORE the request and removes rows gone from the server', () => {
    const fn = sliceFn(src, 'export async function pullNoteVersionsForNote');
    const readIdx = fn.indexOf("noteHistoryStore.query('note_id', noteId)");
    const fetchIdx = fn.indexOf('authFetch(');
    const decideIdx = fn.indexOf('versionsDeletedOnServer(');
    const deleteIdx = fn.indexOf('noteHistoryStore.deleteMany(goneFromServer)');
    expect(readIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(readIdx);
    expect(decideIdx).toBeGreaterThan(fetchIdx);
    expect(deleteIdx).toBeGreaterThan(decideIdx);
    // A failed request must not be read as "the server has nothing".
    expect(fn.slice(fetchIdx, decideIdx)).toMatch(/if \(!res\.ok\) return;/);
  });

  it('both version push paths reap a version deleted while its POST was in flight', () => {
    const single = sliceFn(src, 'export function pushNoteVersion(');
    const batch = sliceFn(src, 'async function pushPendingVersions', '\n}\n');
    expect(single).toMatch(/markVersionSyncedOrReap\(entry\)/);
    expect(batch).toMatch(/markVersionSyncedOrReap\(entry\)/);
    const reap = sliceFn(src, 'async function markVersionSyncedOrReap', '\n}\n');
    expect(reap).toMatch(/method: 'DELETE'/);
    // A failed reap throws so retryWithBackoff runs the push (and the reap) again.
    expect(reap).toMatch(/throw new Error/);
  });

  it('server deletes are awaited and throw on failure (no fire-and-forget)', () => {
    const fn = sliceFn(src, 'async function deleteVersionsRequest', '\n}\n');
    expect(fn).toMatch(/if \(!isAuthenticated\(\)\) return;/);
    expect(fn).toMatch(/if \(!res\.ok\) throw new Error/);
    expect(fn).not.toMatch(/pushSilently/);
  });
});
