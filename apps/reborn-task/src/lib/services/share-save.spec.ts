import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedSnapshotTaskPayload } from '@reborn/types';
import {
  PENDING_SHARE_SAVE_TTL_MS,
  clearSharedTaskSave,
  stashSharedTaskSave,
  takeSharedTaskSave,
  taskFromSnapshot,
  type SharedTaskDraft
} from './share-save';

type Snapshot = Pick<
  SharedSnapshotTaskPayload,
  'title' | 'display_name' | 'description' | 'metadata' | 'subtasks'
>;

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { title: 'Pack for the trip', metadata: {}, subtasks: [], ...overrides };
}

const draft: SharedTaskDraft = {
  title: 'Shopping',
  description: 'Before 6 pm',
  due_date: '2026-12-01T00:00:00.000Z',
  has_time: false,
  subtasks: [
    { title: 'milk', is_completed: true },
    { title: 'bread', is_completed: false }
  ]
};

afterEach(() => {
  clearSharedTaskSave();
  vi.unstubAllGlobals();
});

describe('taskFromSnapshot', () => {
  it('takes the display name the recipient saw over the original title', () => {
    expect(
      taskFromSnapshot(snapshot({ title: 'Bank passwords', display_name: 'Trip plan' }), 'Untitled')
        .title
    ).toBe('Trip plan');
  });

  it('falls back to the original title, then to the untitled label', () => {
    expect(taskFromSnapshot(snapshot({ title: ' Call mum ' }), 'Untitled').title).toBe('Call mum');
    expect(taskFromSnapshot(snapshot({ title: 'T', display_name: '   ' }), 'Untitled').title).toBe(
      'T'
    );
    expect(taskFromSnapshot(snapshot({ title: '  ' }), 'Bez tytułu').title).toBe('Bez tytułu');
  });

  it('keeps the description as shared and omits a blank one', () => {
    const description = '  Bring **cash**\n\n- gate B\n';
    expect(taskFromSnapshot(snapshot({ description }), 'Untitled').description).toBe(description);
    expect(taskFromSnapshot(snapshot({ description: ' \n ' }), 'Untitled')).not.toHaveProperty(
      'description'
    );
    expect(taskFromSnapshot(snapshot(), 'Untitled')).not.toHaveProperty('description');
  });

  it('keeps the due date and its time of day', () => {
    const withTime = taskFromSnapshot(
      snapshot({ metadata: { due_date: '2026-12-01T14:30:00.000Z', has_time: true } }),
      'Untitled'
    );
    expect(withTime).toMatchObject({ due_date: '2026-12-01T14:30:00.000Z', has_time: true });

    const dateOnly = taskFromSnapshot(
      snapshot({ metadata: { due_date: '2026-12-01T00:00:00.000Z', has_time: false } }),
      'Untitled'
    );
    expect(dateOnly).toMatchObject({ due_date: '2026-12-01T00:00:00.000Z', has_time: false });
  });

  it('stores the due date in the app format', () => {
    expect(
      taskFromSnapshot(snapshot({ metadata: { due_date: '2026-12-01' } }), 'Untitled').due_date
    ).toBe('2026-12-01T00:00:00.000Z');
  });

  it('drops a due date that is not a date, and the time of day with it', () => {
    const draftWithJunk = taskFromSnapshot(
      snapshot({ metadata: { due_date: 'tomorrow-ish', has_time: true } }),
      'Untitled'
    );
    expect(draftWithJunk).toMatchObject({ due_date: null, has_time: false });
  });

  it('has no due date when the snapshot has none', () => {
    expect(taskFromSnapshot(snapshot({ metadata: { due_date: null } }), 'Untitled')).toMatchObject(
      { due_date: null, has_time: false }
    );
    expect(
      taskFromSnapshot(snapshot({ metadata: { has_time: true } }), 'Untitled').has_time
    ).toBe(false);
  });

  it('starts the task open even when the sender completed it', () => {
    const result = taskFromSnapshot(snapshot({ metadata: { is_completed: true } }), 'Untitled');
    expect(result).not.toHaveProperty('is_completed');
  });

  it('keeps the subtasks in order with the tick the recipient saw', () => {
    const result = taskFromSnapshot(
      snapshot({
        subtasks: [
          { name: 'passport', metadata: { is_completed: true } },
          { name: ' tickets ', metadata: { is_completed: false } },
          { name: 'charger' }
        ]
      }),
      'Untitled'
    );
    expect(result.subtasks).toEqual([
      { title: 'passport', is_completed: true },
      { title: 'tickets', is_completed: false },
      { title: 'charger', is_completed: false }
    ]);
  });

  it('skips subtasks without a name', () => {
    const result = taskFromSnapshot(
      snapshot({ subtasks: [{ name: '  ' }, { name: 'keep' }, { name: '' }] }),
      'Untitled'
    );
    expect(result.subtasks).toEqual([{ title: 'keep', is_completed: false }]);
  });

  it('carries nothing that points back at the share or the sender', () => {
    const result = taskFromSnapshot(
      {
        ...snapshot(),
        // Extra fields of a full payload must not ride along.
        ...({ source_id: 'sender-task-id', shared_by_label: 'Anna', shared_at: 'x' } as object)
      } as Snapshot,
      'Untitled'
    );
    expect(Object.keys(result).sort()).toEqual(['due_date', 'has_time', 'subtasks', 'title']);
  });
});

describe('pending share save', () => {
  it('hands the draft over once', () => {
    stashSharedTaskSave(draft, 'user-1', 1000);
    expect(takeSharedTaskSave('user-1', 2000)).toEqual(draft);
    expect(takeSharedTaskSave('user-1', 2000)).toBeNull();
  });

  it('returns nothing when no draft is waiting', () => {
    expect(takeSharedTaskSave('user-1')).toBeNull();
  });

  it('drops a draft older than the TTL', () => {
    stashSharedTaskSave(draft, null, 0);
    expect(takeSharedTaskSave('user-1', PENDING_SHARE_SAVE_TTL_MS + 1)).toBeNull();
  });

  it('keeps a draft right up to the TTL', () => {
    stashSharedTaskSave(draft, null, 0);
    expect(takeSharedTaskSave('user-1', PENDING_SHARE_SAVE_TTL_MS)).toEqual(draft);
  });

  it('lets any account take a draft stashed while nobody was signed in', () => {
    stashSharedTaskSave(draft, null, 0);
    expect(takeSharedTaskSave('fresh-account', 10)).toEqual(draft);
  });

  it('drops the draft when another account unlocks than the one the app was on', () => {
    stashSharedTaskSave(draft, 'user-1', 0);
    expect(takeSharedTaskSave('user-2', 10)).toBeNull();
    // ...and it is gone for the first account too (one shot).
    expect(takeSharedTaskSave('user-1', 10)).toBeNull();
  });

  it('a later Save replaces the waiting draft', () => {
    stashSharedTaskSave(draft, null, 0);
    const second = { ...draft, title: 'Second', subtasks: [] };
    stashSharedTaskSave(second, null, 5);
    expect(takeSharedTaskSave('user-1', 10)).toEqual(second);
  });

  it('copies the draft, so later changes to the caller object do not leak in', () => {
    const mutable: SharedTaskDraft = {
      ...draft,
      subtasks: draft.subtasks.map((subtask) => ({ ...subtask }))
    };
    stashSharedTaskSave(mutable, null, 0);
    mutable.title = 'changed';
    mutable.subtasks[0].title = 'changed';
    mutable.subtasks.push({ title: 'extra', is_completed: false });
    expect(takeSharedTaskSave('user-1', 1)).toEqual(draft);
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

    stashSharedTaskSave(draft, 'user-1', 0);
    takeSharedTaskSave('user-1', 1);
    clearSharedTaskSave();

    for (const store of [local, session]) {
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.getItem).not.toHaveBeenCalled();
    }
  });
});
