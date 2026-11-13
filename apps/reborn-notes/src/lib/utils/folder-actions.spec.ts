import { describe, expect, it, vi } from 'vitest';

// The icons are Svelte components; this spec runs without the Svelte plugin
// and only needs to tell them apart.
vi.mock('@lucide/svelte', () => {
  const names = [
    'Archive',
    'ArrowDown',
    'ArrowUp',
    'CornerUpRight',
    'FilePlus',
    'FolderInput',
    'FolderPlus',
    'Palette',
    'Pencil',
    'RefreshCw',
    'Trash2',
    'Upload'
  ];
  return Object.fromEntries(names.map((name) => [name, name]));
});

import { buildFolderActions, type FolderActionHandlers } from './folder-actions';

const t = (key: string) => key;

function handlers(overrides: Partial<FolderActionHandlers> = {}): FolderActionHandlers {
  return {
    syncNow: vi.fn(),
    newNote: vi.fn(),
    newSubfolder: vi.fn(),
    rename: vi.fn(),
    appearance: vi.fn(),
    move: vi.fn(),
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    importFiles: vi.fn(),
    importFolder: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
    ...overrides
  };
}

const keys = (actions: { key: string }[]) => actions.map((a) => a.key);
const separated = (actions: { key: string; separatorBefore?: boolean }[]) =>
  actions.filter((a) => a.separatorBefore).map((a) => a.key);

describe('buildFolderActions', () => {
  it('lists every action in menu order', () => {
    const actions = buildFolderActions({ decrypt_failed: false }, handlers(), {
      t,
      syncConfigId: 'cfg-1'
    });
    expect(keys(actions)).toEqual([
      'sync',
      'new-note',
      'new-subfolder',
      'rename',
      'appearance',
      'move',
      'move-up',
      'move-down',
      'import-md',
      'import-folder',
      'archive',
      'delete'
    ]);
    // Three groups: sync | everyday actions | archive + delete.
    expect(separated(actions)).toEqual(['new-note', 'archive']);
    expect(actions.filter((a) => a.destructive).map((a) => a.key)).toEqual(['delete']);
  });

  it('labels come from the translator passed in', () => {
    const actions = buildFolderActions({ decrypt_failed: false }, handlers(), {
      t: (key) => `<${key}>`
    });
    expect(actions.find((a) => a.key === 'rename')?.label).toBe('<folders.rename>');
    expect(actions.find((a) => a.key === 'archive')?.label).toBe('<archive.folder_action>');
  });

  it('hides sync for a folder that is not a sync destination', () => {
    const actions = buildFolderActions({ decrypt_failed: false }, handlers(), { t });
    expect(keys(actions)).not.toContain('sync');
    // No leading separator when the sync group is absent.
    expect(separated(actions)).toEqual(['archive']);
  });

  it('hides an item whose handler the surface left out', () => {
    const actions = buildFolderActions(
      { decrypt_failed: false },
      handlers({
        newNote: undefined,
        newSubfolder: undefined,
        moveUp: undefined,
        moveDown: undefined
      }),
      { t, syncConfigId: 'cfg-1' }
    );
    expect(keys(actions)).toEqual([
      'sync',
      'rename',
      'appearance',
      'move',
      'import-md',
      'import-folder',
      'archive',
      'delete'
    ]);
    // The separator moves to the first item that renders after the divide.
    expect(separated(actions)).toEqual(['rename', 'archive']);
  });

  it('offers only the repair and delete for an undecryptable folder row', () => {
    const actions = buildFolderActions({ decrypt_failed: true }, handlers(), {
      t,
      syncConfigId: 'cfg-1'
    });
    expect(keys(actions)).toEqual(['rename', 'delete']);
    expect(separated(actions)).toEqual(['delete']);
  });

  it('keeps the working items for an undecryptable folder in the header menu', () => {
    const actions = buildFolderActions(
      { decrypt_failed: true },
      handlers({ moveUp: undefined, moveDown: undefined }),
      { t, undecryptable: 'full' }
    );
    expect(keys(actions)).toEqual([
      'new-note',
      'new-subfolder',
      'rename',
      'move',
      'import-md',
      'import-folder',
      'delete'
    ]);
    // Archive is hidden, so Delete carries the group separator.
    expect(separated(actions)).toEqual(['delete']);
  });

  it('runs the matching handler with the originating event', () => {
    const h = handlers();
    const actions = buildFolderActions({ decrypt_failed: false }, h, { t, syncConfigId: 'cfg-1' });
    const event = new Event('click');
    for (const action of actions) action.run(event);
    for (const fn of Object.values(h)) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(event);
    }
  });
});
