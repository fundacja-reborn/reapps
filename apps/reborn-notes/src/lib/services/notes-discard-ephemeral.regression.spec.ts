import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: discard a pristine "new note" the user backs out of (#349).
 *
 * A New Note created via the button is saved locally with a real id (so the
 * editor can open it) but flagged `is_ephemeral` and NOT pushed. The sync sweep
 * skips it, so the server never sees it. The first deliberate action (edit,
 * rename, move, pin, star, tag) promotes it: the flag is cleared and the row is
 * POSTed as a normal create (a PATCH would 404 - the server has no row yet).
 * Leaving it untouched discards the local row with zero server contact.
 *
 * Source-level, like notes-sync.regression.spec.ts and
 * note-version-baseline.regression.spec.ts: these services import browser-only
 * modules (IndexedDB stores, i18n, crypto) that are impractical to wire up in a
 * Node test env, so the invariants are pinned against the source text.
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

function noteServiceSrc(): string {
  return readSource('./note.service.ts');
}

/** Slice a top-level `export ... function NAME` body up to the next top-level close. */
function sliceFn(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, `function not found: ${header}`).toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Slice a one-level-indented class method body up to the next `\n  }`. */
function sliceMethod(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, `method not found: ${header}`).toBeGreaterThan(-1);
  const end = src.indexOf('\n  }', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('#349 ephemeral new note - the local-only marker', () => {
  it('NoteStoredLocal carries an optional local-only is_ephemeral flag', () => {
    const iface = readSource('../../../../../packages/types/src/entities/note.ts');
    expect(iface).toMatch(/is_ephemeral\?:\s*boolean/);
    // It must live on the LOCAL type only, never on the wire (NoteEncrypted).
    const encrypted = iface.slice(
      iface.indexOf('interface NoteEncrypted'),
      iface.indexOf('interface NoteStoredLocal')
    );
    expect(encrypted).not.toMatch(/is_ephemeral/);
  });

  it('the zod schema allows is_ephemeral on NoteStoredLocal only', () => {
    const schema = readSource('../../../../../packages/types/src/schemas/entities/note.ts');
    const local = schema.slice(schema.indexOf('NoteStoredLocalSchema'));
    expect(local).toMatch(/is_ephemeral:\s*z\.boolean\(\)\.optional\(\)/);
    const wire = schema.slice(
      schema.indexOf('NoteEncryptedSchema = '),
      schema.indexOf('NoteStoredLocalSchema')
    );
    expect(wire).not.toMatch(/is_ephemeral/);
  });
});

describe('#349 create defers the push', () => {
  it('createNote flags is_ephemeral and skips the push for an ephemeral note', () => {
    const fn = sliceFn(noteServiceSrc(), 'export async function createNote');
    // Option plumbed through.
    expect(fn).toMatch(/ephemeral\?:\s*boolean/);
    expect(fn).toMatch(/const\s+ephemeral\s*=\s*options\?\.ephemeral\s*===\s*true/);
    // Row carries the flag only when ephemeral.
    expect(fn).toMatch(/ephemeral\s*\?\s*\{\s*is_ephemeral:\s*true\s*\}\s*:\s*\{\s*\}/);
    // Push is gated on BOTH skipSync and ephemeral - an ephemeral note is never
    // POSTed at create time.
    expect(fn).toMatch(/if\s*\(\s*!options\?\.skipSync\s*&&\s*!ephemeral\s*\)/);
  });

  it('handleNewNote creates the New Note as ephemeral', () => {
    const page = readSource('../../routes/+page.svelte');
    // The ephemeral create lives in the shared createEphemeralNote helper (#349),
    // which both new-note entry points (handleNewNote, handleNewNoteInFolder) call.
    const helper = page.slice(page.indexOf('async function createEphemeralNote'));
    expect(helper).toMatch(/notesStore\.create\([^)]*\{\s*ephemeral:\s*true\s*\}\s*\)/s);
    const newNote = page.slice(
      page.indexOf('async function handleNewNote'),
      page.indexOf('async function handlePeriodic')
    );
    expect(newNote).toMatch(/createEphemeralNote\(\)/);
  });
});

describe('#349 the sync sweep never pushes an ephemeral note (zero-knowledge)', () => {
  it('pushPendingItems excludes is_ephemeral from both note buckets', () => {
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export async function pushPendingItems'),
      src.indexOf('/** Retry a function with exponential backoff')
    );
    // Non-archived pending creates/updates.
    expect(fn).toMatch(/const\s+pendingNotes\s*=\s*allNotes\.filter/);
    // Archived pending soft-deletes.
    expect(fn).toMatch(/const\s+pendingArchivedNotes\s*=\s*allNotes\.filter/);
    // BOTH filters must drop ephemeral rows - the server must never learn the
    // note existed until the user's first deliberate action promotes it.
    const ephemeralGuards = fn.match(/!n\.is_ephemeral/g) ?? [];
    expect(ephemeralGuards.length).toBe(2);
  });
});

describe('#349 the first deliberate action promotes via POST', () => {
  it('pushNoteMutation POSTs a never-synced ephemeral row, PATCHes otherwise', () => {
    const src = readSource('./notes-sync.service.ts');
    const fn = src.slice(
      src.indexOf('export function pushNoteMutation'),
      src.indexOf('export function pushNoteDelete')
    );
    expect(fn).toMatch(/wasEphemeral:\s*boolean/);
    // First server contact for an ephemeral note is a POST (full row), not a PATCH.
    expect(fn).toMatch(/if\s*\(\s*wasEphemeral\s*\)\s*\{\s*pushNote\s*\(\s*row\s*\)/s);
    expect(fn).toMatch(/pushNoteUpdate\s*\(\s*row\.id/);
  });

  it.each([
    ['updateNote', 'export async function updateNote'],
    ['renameNote', 'export async function renameNote'],
    ['togglePin', 'export async function togglePin'],
    ['toggleStar', 'export async function toggleStar'],
    ['setNotePeriodicMetadata', 'export async function setNotePeriodicMetadata']
  ])('%s captures wasEphemeral, clears the flag, and routes through pushNoteMutation', (_name, header) => {
    const fn = sliceFn(noteServiceSrc(), header);
    expect(fn).toMatch(/wasEphemeral\s*=\s*existing\.is_ephemeral\s*===\s*true/);
    // Clear the flag only when promoting (keeps normal rows clean).
    expect(fn).toMatch(/wasEphemeral\s*\?\s*\{\s*is_ephemeral:\s*false\s*\}\s*:\s*\{\s*\}/);
    expect(fn).toMatch(/pushNoteMutation\s*\(/);
  });

  it('setTagsForNote promotes an ephemeral note when tags are assigned', () => {
    const fn = sliceFn(readSource('./tag.service.ts'), 'export async function setTagsForNote');
    expect(fn).toMatch(/wasEphemeral\s*=\s*existing\.is_ephemeral\s*===\s*true/);
    expect(fn).toMatch(/pushNoteMutation\s*\(/);
  });

  it('moveNoteToFolder POSTs when ephemeral, PATCHes otherwise', () => {
    const fn = sliceFn(noteServiceSrc(), 'export async function moveNoteToFolder');
    expect(fn).toMatch(/wasEphemeral\s*=\s*current\?\.is_ephemeral\s*===\s*true/);
    expect(fn).toMatch(/pushNoteMutation\s*\(/);
    // Normal (non-ephemeral) move keeps the explicit folder_id PATCH.
    expect(fn).toMatch(/pushNoteUpdate\s*\(\s*id,\s*\{\s*folder_id:\s*folderId\s*\}\s*\)/);
  });

  it('folder detach skips the push for an ephemeral note (no promotion, no 404)', () => {
    const fn = readSource('./folder.service.ts');
    const detach = fn.slice(fn.indexOf('// Detach'), fn.indexOf('// Detach') + 600);
    expect(detach).toMatch(/if\s*\(\s*!current\?\.is_ephemeral\s*\)\s*pushNoteUpdate/);
  });
});

describe('#349 discard leaves no trace', () => {
  it('discardEphemeralNote hard-deletes the row WITHOUT any server delete', () => {
    const fn = sliceFn(noteServiceSrc(), 'export async function discardEphemeralNote');
    expect(fn).toMatch(/noteStore\.delete\s*\(\s*id\s*\)/);
    expect(fn).toMatch(/noteIndex\.remove\s*\(\s*id\s*\)/);
    // The whole point: the server never saw it, so we must NOT issue a DELETE.
    expect(fn).not.toMatch(/pushNoteDelete/);
  });

  it('discardIfEphemeral is gated on the flag', () => {
    const fn = sliceFn(noteServiceSrc(), 'export async function discardIfEphemeral');
    expect(fn).toMatch(/if\s*\(\s*!existing\?\.is_ephemeral\s*\)\s*return\s+false/);
    expect(fn).toMatch(/discardEphemeralNote\s*\(\s*id\s*\)/);
    expect(fn).toMatch(/return\s+true/);
  });

  it('deleteNote hard-deletes an ephemeral note instead of moving it to Trash', () => {
    const fn = sliceFn(noteServiceSrc(), 'export async function deleteNote');
    // The ephemeral branch must come BEFORE the archive call and return early.
    const branchIdx = fn.search(/if\s*\(\s*existing\?\.is_ephemeral\s*\)/);
    const archiveIdx = fn.search(/noteOperations\.archive/);
    expect(branchIdx).toBeGreaterThan(-1);
    expect(archiveIdx).toBeGreaterThan(branchIdx);
    expect(fn).toMatch(/discardEphemeralNote\s*\(\s*id\s*\)/);
  });

  it('cleanEphemeralNotes sweeps leftover ephemeral rows on startup', () => {
    const fn = sliceFn(noteServiceSrc(), 'export async function cleanEphemeralNotes');
    expect(fn).toMatch(/filter\s*\(\s*\(n\)\s*=>\s*n\.is_ephemeral\s*===\s*true\s*\)/);
    expect(fn).toMatch(/discardEphemeralNote/);
  });

  it('the client startup hook runs cleanEphemeralNotes', () => {
    const hook = readSource('../../hooks.client.ts');
    expect(hook).toMatch(/cleanEphemeralNotes/);
  });
});

describe('#349 leave-on-untouched (note-detail service)', () => {
  function noteDetailSrc(): string {
    return readSource('./note-detail.service.svelte.ts');
  }

  it('isUntouchedThisLoad requires no pending edits, no edits since snapshot, empty body', () => {
    const method = sliceMethod(noteDetailSrc(), 'private isUntouchedThisLoad');
    expect(method).toMatch(/!this\.hasPendingChanges\(\)/);
    expect(method).toMatch(/!this\.editedSinceLastSnapshot/);
    expect(method).toMatch(/this\.content\.trim\(\)\s*===\s*''/);
  });

  it('leaveNote discards a pristine ephemeral note (refreshing the list), else flushes+snapshots', () => {
    const method = sliceMethod(noteDetailSrc(), 'async leaveNote');
    expect(method).toMatch(/this\.isUntouchedThisLoad\(\)\s*&&\s*\(await\s+discardIfEphemeral/);
    // The discarded note must leave the sidebar immediately, not at the next sync.
    expect(method).toMatch(/notesStore\.refresh\(\)/);
    expect(method).toMatch(/return\s+this\.flushAndSnapshot\s*\(\s*id\s*\)/);
  });

  it('loadNote discards a pristine ephemeral previous note (refreshing the list) instead of saving it', () => {
    const method = sliceMethod(noteDetailSrc(), 'async loadNote');
    expect(method).toMatch(/this\.isUntouchedThisLoad\(\)\s*&&\s*\(await\s+discardIfEphemeral\s*\(\s*prevId\s*\)\s*\)/);
    // Falls back to the original flush+snapshot when not discarded.
    expect(method).toMatch(/if\s*\(\s*!discarded\s*\)/);
    // Drops the discarded note from the visible list right away.
    expect(method).toMatch(/notesStore\.refresh\(\)/);
  });

  it('+page.svelte routes both leave paths (note close, navigation) through leaveNote', () => {
    const page = readSource('../../routes/+page.svelte');
    // Closing the open note (activeNoteId -> null).
    expect(page).toMatch(/noteDetailService\.leaveNote\(prev\)/);
    // beforeNavigate, clean path (the call, not the import of the same name).
    const navIdx = page.indexOf('beforeNavigate((');
    expect(navIdx).toBeGreaterThan(-1);
    const beforeNav = page.slice(navIdx, navIdx + 600);
    expect(beforeNav).toMatch(/noteDetailService\.leaveNote\(\)/);
  });
});
