/**
 * Sequential per-id execution with Promise.allSettled. Returns counts of
 * fulfilled vs rejected so bulk callers can surface partial-failure toasts
 * without aborting on a single bad id (e.g. a note already deleted in
 * another tab).
 */
export async function bulkRun<T>(
  ids: T[],
  op: (id: T) => Promise<void>
): Promise<{ done: number; failed: number }> {
  const results = await Promise.allSettled(ids.map((id) => op(id)));
  const done = results.filter((r) => r.status === 'fulfilled').length;
  return { done, failed: results.length - done };
}
