import { describe, expect, it } from 'vitest';
import { resolveNewNoteFolder } from './new-note-folder';

const existing = new Set(['inbox', 'work']);
const exists = (id: string) => existing.has(id);

describe('resolveNewNoteFolder (#522)', () => {
  it('uses the open folder, whatever the setting says', () => {
    expect(resolveNewNoteFolder('work', 'inbox', exists)).toBe('work');
    expect(resolveNewNoteFolder('work', null, exists)).toBe('work');
  });

  it('keeps a note made at the top of the folder tree without a folder', () => {
    expect(resolveNewNoteFolder(null, 'inbox', exists)).toBeUndefined();
  });

  it('uses the chosen folder when no folder is open', () => {
    expect(resolveNewNoteFolder(undefined, 'inbox', exists)).toBe('inbox');
  });

  it('falls back to no folder without a choice, or when the folder is gone', () => {
    expect(resolveNewNoteFolder(undefined, null, exists)).toBeUndefined();
    expect(resolveNewNoteFolder(undefined, 'deleted-folder', exists)).toBeUndefined();
  });
});
