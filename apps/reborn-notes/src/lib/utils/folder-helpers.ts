import type { FolderWithChildren } from '@reborn/types';

/** Flatten a nested folder tree into a flat array of {id, name}. */
export function flattenFolderTree(
  nodes: FolderWithChildren[],
  result: { id: string; name: string }[] = []
): { id: string; name: string }[] {
  for (const f of nodes) {
    result.push({ id: f.id, name: f.name });
    flattenFolderTree(f.children ?? [], result);
  }
  return result;
}

/** Flatten a nested folder tree preserving nesting depth (for indented menus). */
export function flattenFoldersWithDepth(
  nodes: FolderWithChildren[],
  depth = 0
): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((f) => [
    { id: f.id, name: f.name, depth },
    ...flattenFoldersWithDepth(f.children ?? [], depth + 1)
  ]);
}

/** Return IDs of all ancestors (parent → root) so the tree can be expanded to show `folderId`. */
export function getAncestorIds(folderId: string, tree: FolderWithChildren[]): string[] {
  const parentMap = new Map<string, string>();
  function buildMap(nodes: FolderWithChildren[]) {
    for (const n of nodes) {
      for (const c of n.children ?? []) {
        parentMap.set(c.id, n.id);
        buildMap(n.children ?? []);
      }
    }
  }
  buildMap(tree);
  const ancestors: string[] = [];
  let current = parentMap.get(folderId);
  while (current) {
    ancestors.push(current);
    current = parentMap.get(current);
  }
  return ancestors;
}
