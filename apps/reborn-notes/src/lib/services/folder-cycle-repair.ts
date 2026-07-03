import type { FolderEncrypted } from '@reborn/types';

/**
 * Detection and repair planning for folder `parent_id` cycles (audit 013 N2).
 *
 * The server does not validate the folder graph beyond direct self-parenting,
 * so two devices moving concurrently (A under B on one, B under A on the
 * other) both pass their local pre-move cycle checks and both writes land -
 * the server ends up with a cycle. Tree materialization walks from the roots,
 * so every member of a cycle (and its whole subtree) silently disappears from
 * the folder views on all devices.
 *
 * Pull is the choke point where each device converges on server state, so
 * `pullFolders()` runs this detection over the local mirror and reparents ONE
 * member per cycle to the root. Picking the most recently updated member
 * undoes the move that closed the cycle while preserving the other device's
 * earlier move, and because the timestamps come from the server, every device
 * picks the SAME member - concurrent repairs converge instead of cutting
 * different edges.
 */

type FolderRow = Pick<FolderEncrypted, 'id' | 'parent_id' | 'updated_at'>;

/**
 * Find all `parent_id` cycles. Returns each cycle as the list of member ids
 * (only the loop itself - folders that merely hang off a cycle are not
 * members; reparenting one member makes the whole subtree reachable again).
 * A parent id pointing at a row absent from `rows` terminates the walk (a
 * dangling FK is not a cycle).
 */
export function findFolderCycles(rows: FolderRow[]): string[][] {
  const parentById = new Map(rows.map((r) => [r.id, r.parent_id]));
  // Ids whose walk already terminated (reached a root, a dangling parent, or
  // a previously classified chain) - each node is walked at most once.
  const resolved = new Set<string>();
  const cycles: string[][] = [];

  for (const row of rows) {
    if (resolved.has(row.id)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cursor: string | undefined = row.id;
    while (cursor !== undefined && parentById.has(cursor) && !resolved.has(cursor)) {
      const seenAt = pathIndex.get(cursor);
      if (seenAt !== undefined) {
        // Walked back into the current path - the loop portion is the cycle.
        cycles.push(path.slice(seenAt));
        break;
      }
      pathIndex.set(cursor, path.length);
      path.push(cursor);
      cursor = parentById.get(cursor) ?? undefined;
    }
    for (const id of path) resolved.add(id);
  }

  return cycles;
}

/**
 * Pick the cycle member to reparent to the root: newest `updated_at` (= the
 * move that closed the cycle), ties broken by the greater id so the choice
 * stays deterministic across devices.
 */
export function pickCycleRepairTarget(cycle: string[], byId: Map<string, FolderRow>): string {
  return cycle.reduce((best, id) => {
    const bestTime = Date.parse(byId.get(best)?.updated_at ?? '') || 0;
    const time = Date.parse(byId.get(id)?.updated_at ?? '') || 0;
    if (time > bestTime) return id;
    if (time === bestTime && id > best) return id;
    return best;
  });
}

/** Ids to reparent to the root - one per detected cycle. */
export function planCycleRepairs(rows: FolderRow[]): string[] {
  const cycles = findFolderCycles(rows);
  if (cycles.length === 0) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return cycles.map((cycle) => pickCycleRepairTarget(cycle, byId));
}
