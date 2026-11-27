import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_SHARE_SAVE_TTL_MS,
  clearSharedNoteSave,
  noteFromSnapshot,
  stashSharedNoteSave,
  takeSharedNoteSave
} from './share-save';

const draft = { title: 'Shopping', content: '# Shopping\n\n- milk\n' };

afterEach(() => {
  clearSharedNoteSave();
  vi.unstubAllGlobals();
});

describe('noteFromSnapshot', () => {
  it('takes the display name the recipient saw over the original title', () => {
    expect(
      noteFromSnapshot({ title: 'Bank passwords', display_name: 'Trip plan', content: 'x' }, 'Untitled')
        .title
    ).toBe('Trip plan');
  });

  it('falls back to the original title, then to the untitled label', () => {
    expect(noteFromSnapshot({ title: ' Notes ', content: '' }, 'Untitled').title).toBe('Notes');
    expect(noteFromSnapshot({ title: 'T', display_name: '   ', content: '' }, 'Untitled').title).toBe(
      'T'
    );
    expect(noteFromSnapshot({ title: '  ', content: '' }, 'Bez tytułu').title).toBe('Bez tytułu');
  });

  it('keeps the shared Markdown byte for byte', () => {
    const content = '  # Title\n\n![img](https://example.com/a.png)\n[[Other note]]\n\n';
    expect(noteFromSnapshot({ title: 'T', content }, 'Untitled').content).toBe(content);
  });
});

describe('pending share save', () => {
  it('hands the draft over once', () => {
    stashSharedNoteSave(draft, 'user-1', 1000);
    expect(takeSharedNoteSave('user-1', 2000)).toEqual(draft);
    expect(takeSharedNoteSave('user-1', 2000)).toBeNull();
  });

  it('returns nothing when no draft is waiting', () => {
    expect(takeSharedNoteSave('user-1')).toBeNull();
  });

  it('drops a draft older than the TTL', () => {
    stashSharedNoteSave(draft, null, 0);
    expect(takeSharedNoteSave('user-1', PENDING_SHARE_SAVE_TTL_MS + 1)).toBeNull();
  });

  it('keeps a draft right up to the TTL', () => {
    stashSharedNoteSave(draft, null, 0);
    expect(takeSharedNoteSave('user-1', PENDING_SHARE_SAVE_TTL_MS)).toEqual(draft);
  });

  it('lets any account take a draft stashed while nobody was signed in', () => {
    stashSharedNoteSave(draft, null, 0);
    expect(takeSharedNoteSave('fresh-account', 10)).toEqual(draft);
  });

  it('drops the draft when another account unlocks than the one the app was on', () => {
    stashSharedNoteSave(draft, 'user-1', 0);
    expect(takeSharedNoteSave('user-2', 10)).toBeNull();
    // ...and it is gone for the first account too (one shot).
    expect(takeSharedNoteSave('user-1', 10)).toBeNull();
  });

  it('a later Save replaces the waiting draft', () => {
    stashSharedNoteSave(draft, null, 0);
    stashSharedNoteSave({ title: 'Second', content: 'b' }, null, 5);
    expect(takeSharedNoteSave('user-1', 10)).toEqual({ title: 'Second', content: 'b' });
  });

  it('copies the draft, so later changes to the caller object do not leak in', () => {
    const mutable = { ...draft };
    stashSharedNoteSave(mutable, null, 0);
    mutable.content = 'changed';
    expect(takeSharedNoteSave('user-1', 1)?.content).toBe(draft.content);
  });

  it('never writes the decrypted draft to web storage (Zero Knowledge)', () => {
    const storage = () => ({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0
    });
    const local = storage();
    const session = storage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);

    stashSharedNoteSave(draft, 'user-1', 0);
    takeSharedNoteSave('user-1', 1);
    clearSharedNoteSave();

    for (const store of [local, session]) {
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.getItem).not.toHaveBeenCalled();
    }
  });
});
