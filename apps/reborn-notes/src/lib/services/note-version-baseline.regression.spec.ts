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

  it('captureBaselineSnapshot fires once per load and snapshots the pristine state', () => {
    const method = sliceMethod(noteDetailSrc(), 'private captureBaselineSnapshot');
    // Idempotent guard: bail when already captured this load.
    expect(method).toMatch(/if\s*\(\s*this\.baselineCaptured\s*\)\s*return/);
    // Needs an open note.
    expect(method).toMatch(/this\.noteId/);
    // Flip the flag BEFORE the async snapshot so re-entrant edits don't double up.
    const setFlagIdx = method.search(/this\.baselineCaptured\s*=\s*true/);
    const snapshotIdx = method.search(/saveVersionSnapshot\s*\(/);
    expect(setFlagIdx).toBeGreaterThan(-1);
    expect(snapshotIdx).toBeGreaterThan(setFlagIdx);
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
