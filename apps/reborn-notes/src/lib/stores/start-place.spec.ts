// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Start page (issue #511): where the notes view opens. Pure resolution of the
 * place (start page vs session place vs remembered place), the content-free
 * localStorage record behind "where you left off", and the phone's home section
 * for back navigation.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const STORAGE_KEY = 'reborn-notes-last-place';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const FOLDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEARCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TAG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function loadModule() {
  vi.resetModules();
  return import('./start-place');
}

const view = (over: Partial<import('./start-place').ViewState> = {}) => ({
  section: 'all',
  folderId: undefined,
  savedSearchId: null,
  tagId: null,
  noteId: null,
  ...over
});

beforeEach(() => {
  localStorage.clear();
});

describe('placeFromView', () => {
  it('keeps only the selection that belongs to the section', async () => {
    const { placeFromView } = await loadModule();
    expect(placeFromView(view({ section: 'folders', folderId: FOLDER, tagId: TAG }))).toEqual({
      section: 'folders',
      folderId: FOLDER
    });
    expect(placeFromView(view({ section: 'tags', tagId: TAG, folderId: FOLDER }))).toEqual({
      section: 'tags',
      tagId: TAG
    });
    expect(placeFromView(view({ section: 'starred', folderId: FOLDER, tagId: TAG }))).toEqual({
      section: 'starred'
    });
  });

  it('remembers an open smart folder when no real folder is open', async () => {
    const { placeFromView } = await loadModule();
    expect(placeFromView(view({ section: 'folders', savedSearchId: SEARCH }))).toEqual({
      section: 'folders',
      savedSearchId: SEARCH
    });
  });

  it('treats the "no folder" root (null) as the Folders root', async () => {
    const { placeFromView } = await loadModule();
    expect(placeFromView(view({ section: 'folders', folderId: null }))).toEqual({
      section: 'folders'
    });
  });

  it.each(['trash', 'search', 'shares', 'periodic-daily', 'periodic-monthly'])(
    'reopens %s as All notes, keeping the open note',
    async (section) => {
      const { placeFromView } = await loadModule();
      expect(placeFromView(view({ section, folderId: FOLDER, noteId: NOTE }))).toEqual({
        section: 'all',
        noteId: NOTE
      });
    }
  );
});

describe('initialPlace', () => {
  it('prefers the session place (re-mount within the session)', async () => {
    const { initialPlace } = await loadModule();
    const session = { section: 'tags' as const, tagId: TAG, noteId: NOTE };
    expect(initialPlace('folders', session, null)).toBe(session);
    expect(initialPlace('last', session, { section: 'starred' })).toBe(session);
  });

  it('opens the start page section on a cold start', async () => {
    const { initialPlace } = await loadModule();
    expect(initialPlace('all', null, null)).toEqual({ section: 'all' });
    expect(initialPlace('starred', null, null)).toEqual({ section: 'starred' });
    expect(initialPlace('folders', null, { section: 'tags', tagId: TAG })).toEqual({
      section: 'folders'
    });
    expect(initialPlace('tags', null, null)).toEqual({ section: 'tags' });
  });

  it('"where you left off" opens the remembered place, All notes without one', async () => {
    const { initialPlace } = await loadModule();
    const remembered = { section: 'folders' as const, folderId: FOLDER, noteId: NOTE };
    expect(initialPlace('last', null, remembered)).toBe(remembered);
    expect(initialPlace('last', null, null)).toEqual({ section: 'all' });
  });
});

describe('dropMissing', () => {
  const none = {
    folderIds: new Set<string>(),
    savedSearchIds: new Set<string>(),
    tagIds: new Set<string>()
  };

  it('keeps ids that still exist', async () => {
    const { dropMissing } = await loadModule();
    const existing = { ...none, folderIds: new Set([FOLDER]) };
    expect(dropMissing({ section: 'folders', folderId: FOLDER, noteId: NOTE }, existing)).toEqual({
      section: 'folders',
      folderId: FOLDER,
      noteId: NOTE
    });
  });

  it('opens the section root when the folder / smart folder / tag is gone', async () => {
    const { dropMissing } = await loadModule();
    expect(dropMissing({ section: 'folders', folderId: FOLDER }, none)).toEqual({
      section: 'folders'
    });
    expect(dropMissing({ section: 'folders', savedSearchId: SEARCH }, none)).toEqual({
      section: 'folders'
    });
    expect(dropMissing({ section: 'tags', tagId: TAG }, none)).toEqual({ section: 'tags' });
  });

  it('leaves the note to the IndexedDB check of the caller', async () => {
    const { dropMissing } = await loadModule();
    expect(dropMissing({ section: 'all', noteId: NOTE }, none)).toEqual({
      section: 'all',
      noteId: NOTE
    });
  });
});

describe('mobileHomeSection', () => {
  it('makes Folders / Tags the phone home only when they are the start page', async () => {
    const { mobileHomeSection } = await loadModule();
    expect(mobileHomeSection('folders')).toBe('folders');
    expect(mobileHomeSection('tags')).toBe('tags');
    expect(mobileHomeSection('all')).toBe('all');
    expect(mobileHomeSection('starred')).toBe('all');
    // "Where you left off" may reopen Folders, but All notes stays the root.
    expect(mobileHomeSection('last')).toBe('all');
  });
});

describe('session place', () => {
  it('is empty on a cold start and survives re-mounts in the same session', async () => {
    const mod = await loadModule();
    expect(mod.getSessionPlace(ACCOUNT)).toBeNull();
    mod.setSessionPlace({ section: 'tags', tagId: TAG }, ACCOUNT);
    expect(mod.getSessionPlace(ACCOUNT)).toEqual({ section: 'tags', tagId: TAG });
    // Never written to storage - RAM only.
    expect(localStorage.length).toBe(0);
    // A reload (fresh module) starts over.
    const fresh = await loadModule();
    expect(fresh.getSessionPlace(ACCOUNT)).toBeNull();
  });

  it('does not carry over to another account in the same session', async () => {
    // Signing in from local mode keeps the JS session (no reload).
    const mod = await loadModule();
    mod.setSessionPlace({ section: 'folders', folderId: FOLDER }, OTHER_ACCOUNT);
    expect(mod.getSessionPlace(ACCOUNT)).toBeNull();
    expect(mod.getSessionPlace(null)).toBeNull();
  });

  it('is cleared on request (a different start page was chosen)', async () => {
    const mod = await loadModule();
    mod.setSessionPlace({ section: 'starred' }, ACCOUNT);
    mod.clearSessionPlace();
    expect(mod.getSessionPlace(ACCOUNT)).toBeNull();
  });
});

describe('remembered place (localStorage)', () => {
  it('round-trips a place for the same account, ids only', async () => {
    const { rememberPlace, readRememberedPlace } = await loadModule();
    rememberPlace({ section: 'folders', folderId: FOLDER, noteId: NOTE }, ACCOUNT);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      v: 1,
      account: ACCOUNT,
      section: 'folders',
      folderId: FOLDER,
      noteId: NOTE
    });
    expect(readRememberedPlace(ACCOUNT)).toEqual({
      section: 'folders',
      folderId: FOLDER,
      noteId: NOTE
    });
  });

  it('never opens the place of another account on this device', async () => {
    const { rememberPlace, readRememberedPlace } = await loadModule();
    rememberPlace({ section: 'all', noteId: NOTE }, OTHER_ACCOUNT);
    expect(readRememberedPlace(ACCOUNT)).toBeNull();
    expect(readRememberedPlace(null)).toBeNull();
  });

  it('forgets the place', async () => {
    const { rememberPlace, forgetRememberedPlace, readRememberedPlace } = await loadModule();
    rememberPlace({ section: 'starred' }, ACCOUNT);
    forgetRememberedPlace();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readRememberedPlace(ACCOUNT)).toBeNull();
  });

  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['an older format', JSON.stringify({ v: 0, account: ACCOUNT, section: 'all' })],
    ['an unknown section', JSON.stringify({ v: 1, account: ACCOUNT, section: 'trash' })],
    ['no section', JSON.stringify({ v: 1, account: ACCOUNT })]
  ])('reads %s as nothing remembered', async (_label, raw) => {
    const { readRememberedPlace } = await loadModule();
    localStorage.setItem(STORAGE_KEY, raw);
    expect(readRememberedPlace(ACCOUNT)).toBeNull();
  });

  it('drops ids that are not UUIDs or do not belong to the section', async () => {
    const { parseRememberedPlace } = await loadModule();
    const raw = JSON.stringify({
      v: 1,
      account: ACCOUNT,
      section: 'tags',
      tagId: 'not-a-uuid',
      folderId: FOLDER,
      noteId: '<script>'
    });
    expect(parseRememberedPlace(raw, ACCOUNT)).toEqual({ section: 'tags' });
  });

  it('keeps working when storage throws (private mode, quota)', async () => {
    const { rememberPlace, readRememberedPlace, forgetRememberedPlace } = await loadModule();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => rememberPlace({ section: 'all' }, ACCOUNT)).not.toThrow();
    expect(readRememberedPlace(ACCOUNT)).toBeNull();
    expect(() => forgetRememberedPlace()).not.toThrow();
    setItem.mockRestore();
    getItem.mockRestore();
    removeItem.mockRestore();
  });
});
