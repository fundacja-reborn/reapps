import type { FolderEncrypted } from '@reborn/types';

/**
 * Group folders into BFS layers so pushes go parent-before-child.
 *
 * The server's `POST /api/folders` handler rejects with 404 "Parent folder
 * not found" when `parent_id` references a folder that hasn't landed yet.
 * Flat parallel push (`Promise.allSettled([...folders.map()])`) triggers a
 * wave of 404s + retry-backoff whenever a vault import creates a deeply
 * nested hierarchy from scratch.
 *
 * Layering rule:
 *   - Layer 0: folders with no `parent_id`, OR `parent_id` not present in
 *              the pending set (parent already on the server — safe).
 *   - Layer N: folders whose parent landed in layers 0..N-1.
 *
 * Within a layer, siblings are independent and push in parallel; awaiting
 * between layers guarantees children see their parents server-side.
 *
 * Cycles cannot exist in valid folder data (server enforces a tree), but if
 * one does sneak in via corruption, leftover folders get appended as a final
 * layer so the server can reject them rather than the client silently
 * dropping them on the floor.
 */
export function buildFolderLayers(folders: FolderEncrypted[]): FolderEncrypted[][] {
  if (folders.length === 0) return [];
  const pendingIds = new Set(folders.map((f) => f.id));
  const placed = new Set<string>();
  const layers: FolderEncrypted[][] = [];

  while (placed.size < folders.length) {
    const layer = folders.filter(
      (f) =>
        !placed.has(f.id) &&
        (!f.parent_id || !pendingIds.has(f.parent_id) || placed.has(f.parent_id))
    );
    if (layer.length === 0) {
      layers.push(folders.filter((f) => !placed.has(f.id)));
      break;
    }
    layers.push(layer);
    for (const f of layer) placed.add(f.id);
  }
  return layers;
}
