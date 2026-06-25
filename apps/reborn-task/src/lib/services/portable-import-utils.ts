/**
 * Pure ID-remapping for the portable (cross-account) reborn-task import. Kept in
 * a light module - importing only types - so the remap can be unit-tested
 * without pulling the full import service (IndexedDB stores, cryptoManager,
 * sync queue). Mirrors `reborn-notes` `portable-backup-utils.ts`.
 *
 * Zero Knowledge: this touches only plaintext IDs and foreign keys in memory;
 * no ciphertext, no keys, no server contact.
 */
import type { ListDecrypted, TaskDecrypted, Subtask } from '@reborn/types';

export interface PortableExportData {
  lists: ListDecrypted[];
  tasks: TaskDecrypted[];
  subtasks: Subtask[];
}

/**
 * Default ID generator: the global Web Crypto `randomUUID`. Injectable so tests
 * stay deterministic and independent of the runtime crypto global.
 */
function defaultNewId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Regenerate every entity ID for a portable (cross-account) import and remap the
 * foreign-key chains (`task.task_list_id` -> list, `task.parent_task_id` ->
 * task, `subtask.task_id` -> task) onto the new IDs.
 *
 * Why: the server owns each `id` under the account that first created it.
 * Pushing an imported record that reuses the source account's id collides - the
 * tasklist/task create hits a primary-key unique violation (and the
 * ownership-guarded notes routes 403) so the record never syncs and shows as
 * rejected. Fresh IDs make a portable import additive: genuinely new rows owned
 * by the importing account.
 *
 * Dangling references are handled conservatively: an optional `parent_task_id`
 * whose task is absent from the backup is dropped (the task becomes a root);
 * required refs (`task_list_id`, `subtask.task_id`) fall back to the original id
 * - a complete export always carries the referenced row, so the fallback is only
 * a defensive last resort, never expected to fire.
 */
export function remapPortableIds(
  data: PortableExportData,
  newId: () => string = defaultNewId
): PortableExportData {
  // Pre-assign fresh IDs so foreign keys resolve in a single pass regardless of
  // declaration order (a child task may precede its parent in the array).
  const listIdMap = new Map<string, string>();
  for (const l of data.lists) listIdMap.set(l.id, newId());
  const taskIdMap = new Map<string, string>();
  for (const t of data.tasks) taskIdMap.set(t.id, newId());

  const lists = data.lists.map((l) => ({ ...l, id: listIdMap.get(l.id)! }));

  const tasks = data.tasks.map((t) => {
    const remapped: TaskDecrypted = {
      ...t,
      id: taskIdMap.get(t.id)!,
      task_list_id: listIdMap.get(t.task_list_id) ?? t.task_list_id
    };
    if (t.parent_task_id) {
      // Remap to the parent's new id, or drop (root task) if the parent is not
      // part of this backup - keeping the old id would dangle on the new account.
      // `undefined` is the client-side "no parent" marker (see TaskDecrypted).
      remapped.parent_task_id = taskIdMap.get(t.parent_task_id) ?? undefined;
    }
    return remapped;
  });

  const subtasks = data.subtasks.map((s) => ({
    ...s,
    id: newId(),
    task_id: taskIdMap.get(s.task_id) ?? s.task_id
  }));

  return { lists, tasks, subtasks };
}
