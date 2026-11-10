import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Start page (issue #511) - wiring in the notes view.
 *
 * Source-level, like notes-discard-ephemeral.regression.spec.ts: +page.svelte
 * and note.service.ts pull in browser-only modules (IndexedDB stores, crypto,
 * i18n) that are impractical to mount in a Node test env, so the ordering and
 * gating invariants are pinned against the source text. The decisions they
 * encode live in start-place.ts (unit-tested in start-place.spec.ts).
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

const page = () => readSource('../../routes/+page.svelte');

function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  expect(start, `not found: ${from}`).toBeGreaterThan(-1);
  const end = src.indexOf(to, start + from.length);
  expect(end, `not found after ${from}: ${to}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('#511 start page - when it opens', () => {
  it('opens only after onMount has read isMobile and set up the history trampoline', () => {
    // isMobile is false until onMount; opening Folders before that would take
    // the desktop path on a phone (first folder instead of the tree, no history
    // entry). The trampoline must exist before the Folders entry is pushed.
    const mount = between(page(), 'onMount(() => {', 'function handlePopstate');
    const isMobileAt = mount.indexOf('isMobile = mq.matches');
    const trampolineAt = mount.indexOf("history.pushState({ _rn: 'app' }, '')");
    const readyAt = mount.indexOf('viewMounted = true');
    expect(isMobileAt).toBeGreaterThan(-1);
    expect(trampolineAt).toBeGreaterThan(isMobileAt);
    expect(readyAt).toBeGreaterThan(trampolineAt);
  });

  it('a deep-linked section (?section=shares) wins over the start page', () => {
    const deepLink = between(page(), "params.get('section') === 'shares'", 'params.has(');
    expect(deepLink).toMatch(/activeSection = 'shares'/);
    expect(deepLink).toMatch(/placeApplied = true/);
  });

  it('applies once per mount and only while unlocked', () => {
    const src = page();
    // A locked boot mounts the page for a moment before the auth guard
    // redirects - it must not open anything there.
    expect(src).toMatch(
      /if \(!viewMounted \|\| !viewUnlocked \|\| placeApplied\) return;\s*placeApplied = true;/
    );
    expect(src).toMatch(/const viewUnlocked = \$derived\(\s*\$authStore\.hasE2E/);
  });

  it('remembers the place only after it opened, and not while locked', () => {
    // Otherwise the empty default of a re-mount (or a lock resetting the view)
    // would overwrite the place the unlock should return to.
    const remember = between(
      page(),
      'if (!placeTracking || !viewUnlocked) return;',
      '// ── Mobile + beforeunload'
    );
    expect(remember).toMatch(/if \(!account\) return;/);
    expect(remember).toMatch(/setSessionPlace\(place, account\)/);
    expect(remember).toMatch(/if \(persist\) rememberPlace\(place, account\)/);
    expect(remember).toMatch(/const persist = \$startPage === 'last'/);
  });

  it('opens the note last, only if it is still openable and nothing else was opened', () => {
    const open = between(page(), 'async function openPlace(', '// Remember the current place');
    expect(open).toMatch(/NoteService\.isNoteOpenable\(place\.noteId\)/);
    const listAt = open.indexOf('handleFolderSelect(place.folderId)');
    const noteAt = open.indexOf('activeNoteId.set(place.noteId)');
    expect(listAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(listAt);
    expect(open).toMatch(/get\(activeNoteId\) === null\) activeNoteId\.set\(place\.noteId\)/);
  });
});

describe('#511 start page - phone back navigation', () => {
  it('entering the home section pushes no history entry', () => {
    expect(page()).toMatch(
      /isMobile && \(section === 'folders' \|\| section === 'tags'\) && section !== mobileHome/
    );
  });

  it('the home tree / tag list has no back arrow and no "up"', () => {
    const src = page();
    expect(src).toMatch(/\{#if !mobileListIsHome\}\s*<button[\s\S]*?onclick=\{handleMobileBack\}/);
    const up = between(src, 'function navigateUp()', 'let prevSectionForView');
    expect(up).toMatch(
      /\(mobileView === 'folder-tree' \|\| mobileView === 'tag-list'\) && !mobileListIsHome/
    );
    // Up from the other drill-down list leads home, not always to All notes.
    expect(up).toMatch(/activeSection = mobileHome/);
  });

  it('re-tapping the home section in the rail does not push an entry either', () => {
    const click = between(
      page(),
      'async function handleSectionClick',
      'async function applyFolderSelection'
    );
    expect(click).toMatch(/if \(mobileHome !== 'folders'\) pushMobileHistory\(\)/);
    expect(click).toMatch(/if \(mobileHome !== 'tags'\) pushMobileHistory\(\)/);
  });
});

describe('#511 start page - reopening a note', () => {
  it('skips deleted, trashed and pristine ephemeral notes without decrypting', () => {
    const service = readSource('../services/note.service.ts');
    const fn = between(service, 'export async function isNoteOpenable', '\n}');
    expect(fn).toMatch(/noteStore\.get\(id\)/);
    expect(fn).toMatch(/enc != null && !enc\.is_archived && !enc\.is_ephemeral/);
    expect(fn).not.toMatch(/toDecrypted|decrypt/);
  });

  it('logout forgets the remembered place', () => {
    const auth = readSource('./auth.store.ts');
    const logout = between(auth, 'async function logout()', 'clearAllUserData');
    expect(logout).toMatch(/forgetRememberedPlace\(\)/);
  });
});
