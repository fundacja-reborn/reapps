import { describe, it, expect } from 'vitest';
import type { ListDecrypted, TaskDecrypted, Subtask } from '@reborn/types';
import { remapPortableIds, type PortableExportData } from './portable-import-utils';

/**
 * Deterministic, collision-free ID generator injected into `remapPortableIds`
 * so assertions are predictable and independent of `globalThis.crypto`. The
 * function mints list IDs first, then task IDs, then subtask IDs.
 */
function seqIds(prefix = 'new'): () => string {
  let i = 0;
  return () => `${prefix}-${++i}`;
}

const list = (id: string, over: Partial<ListDecrypted> = {}): ListDecrypted => ({
  id,
  name: `List ${id}`,
  order_index: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  ...over
});

const task = (
  id: string,
  task_list_id: string,
  over: Partial<TaskDecrypted> = {}
): TaskDecrypted => ({
  id,
  task_list_id,
  title: `Task ${id}`,
  is_completed: false,
  is_starred: false,
  is_template: false,
  position: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  ...over
});

const subtask = (id: string, task_id: string, over: Partial<Subtask> = {}): Subtask => ({
  id,
  task_id,
  title: `Sub ${id}`,
  is_completed: false,
  position: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  ...over
});

describe('remapPortableIds (reborn-task portable cross-account import)', () => {
  it('regenerates every ID and remaps the list/task/subtask FK chain, preserving other fields', () => {
    const data: PortableExportData = {
      lists: [list('L1')],
      tasks: [
        task('T1', 'L1', { title: 'Parent task' }),
        task('T2', 'L1', { parent_task_id: 'T1', title: 'Child task' })
      ],
      subtasks: [subtask('S1', 'T1')]
    };

    const out = remapPortableIds(data, seqIds());

    // No source ID survives anywhere - reusing one would collide with the source
    // account's rows on the server (PK unique violation / 403 on push).
    const sourceIds = new Set(['L1', 'T1', 'T2', 'S1']);
    const allIds = [
      ...out.lists.map((l) => l.id),
      ...out.tasks.map((t) => t.id),
      ...out.subtasks.map((s) => s.id)
    ];
    for (const id of allIds) expect(sourceIds.has(id)).toBe(false);
    expect(new Set(allIds).size).toBe(allIds.length); // all unique

    const newListId = out.lists[0].id;
    const parent = out.tasks.find((t) => t.title === 'Parent task')!;
    const child = out.tasks.find((t) => t.title === 'Child task')!;

    // task.task_list_id -> list's new id; task.parent_task_id -> parent's new id;
    // subtask.task_id -> its task's new id.
    expect(parent.task_list_id).toBe(newListId);
    expect(child.task_list_id).toBe(newListId);
    expect(child.parent_task_id).toBe(parent.id);
    expect(out.subtasks[0].task_id).toBe(parent.id);

    // Non-ID fields are carried through untouched.
    expect(out.lists[0].name).toBe('List L1');
    expect(parent.position).toBe(0);
    expect(out.subtasks[0].title).toBe('Sub S1');
  });

  it('drops a dangling parent_task_id (parent absent from the backup)', () => {
    const data: PortableExportData = {
      lists: [list('L1')],
      tasks: [task('T2', 'L1', { parent_task_id: 'ghost' })],
      subtasks: []
    };
    const out = remapPortableIds(data, seqIds());
    expect(out.tasks[0].parent_task_id).toBeUndefined();
  });

  it('does not mutate the input payload', () => {
    const data: PortableExportData = {
      lists: [list('L1')],
      tasks: [task('T1', 'L1')],
      subtasks: [subtask('S1', 'T1')]
    };
    remapPortableIds(data, seqIds());
    expect(data.lists[0].id).toBe('L1');
    expect(data.tasks[0].id).toBe('T1');
    expect(data.tasks[0].task_list_id).toBe('L1');
    expect(data.subtasks[0].id).toBe('S1');
  });
});
