import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openNewFolderDraft,
  pendingNewFolderDraft,
  registerNewFolderDraftInput
} from './new-folder-draft.store';

// The draft's name input must be focused before `openNewFolderDraft` returns,
// i.e. still inside the tap handler, or iOS opens no virtual keyboard (#511).
// Node has no DOM, so a store subscriber stands in for the component: in the
// browser, flushSync renders the draft row and its attachment registers the
// input during the store update, exactly where this subscriber runs.

function fakeInput(calls: string[]) {
  return {
    scrollIntoView: vi.fn(() => calls.push('scrollIntoView')),
    focus: vi.fn(() => calls.push('focus')),
    select: vi.fn(() => calls.push('select'))
  } as unknown as HTMLInputElement;
}

function renderDraftRowOnOpen(input: HTMLInputElement) {
  let unregister: (() => void) | undefined;
  const unsubscribe = pendingNewFolderDraft.subscribe((draft) => {
    if (draft && !unregister) unregister = registerNewFolderDraftInput(input);
    if (!draft && unregister) {
      unregister();
      unregister = undefined;
    }
  });
  return () => {
    unsubscribe();
    unregister?.();
  };
}

describe('openNewFolderDraft', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    pendingNewFolderDraft.set(null);
    cleanup?.();
    cleanup = undefined;
  });

  it('opens the draft and focuses its input before returning', () => {
    const calls: string[] = [];
    const input = fakeInput(calls);
    cleanup = renderDraftRowOnOpen(input);

    openNewFolderDraft('folder-1');

    expect(get(pendingNewFolderDraft)).toEqual({ parentId: 'folder-1' });
    expect(calls).toEqual(['scrollIntoView', 'focus', 'select']);
    // focus() must not scroll on its own: scrollIntoView already did, gently.
    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('opens a root draft with parentId null', () => {
    const calls: string[] = [];
    cleanup = renderDraftRowOnOpen(fakeInput(calls));

    openNewFolderDraft(null);

    expect(get(pendingNewFolderDraft)).toEqual({ parentId: null });
    expect(calls).toEqual(['scrollIntoView', 'focus', 'select']);
  });

  it('still opens the draft when no input gets rendered', () => {
    openNewFolderDraft('folder-1');

    expect(get(pendingNewFolderDraft)).toEqual({ parentId: 'folder-1' });
  });

  it('forgets an input once its row is gone', () => {
    const calls: string[] = [];
    const input = fakeInput(calls);
    registerNewFolderDraftInput(input)();

    openNewFolderDraft('folder-1');

    expect(calls).toEqual([]);
  });

  it('keeps the newer input when an older one unregisters late', () => {
    const oldCalls: string[] = [];
    const newCalls: string[] = [];
    const unregisterOld = registerNewFolderDraftInput(fakeInput(oldCalls));
    const unregisterNew = registerNewFolderDraftInput(fakeInput(newCalls));
    unregisterOld();

    openNewFolderDraft(null);
    unregisterNew();

    expect(oldCalls).toEqual([]);
    expect(newCalls).toEqual(['scrollIntoView', 'focus', 'select']);
  });
});
