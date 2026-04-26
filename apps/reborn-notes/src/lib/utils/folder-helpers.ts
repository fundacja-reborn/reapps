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

/** Return direct children of the folder with the given id, or root-level folders for `null`. */
export function findChildrenOfParent(
  tree: FolderWithChildren[],
  parentId: string | null
): FolderWithChildren[] {
  if (parentId === null) return tree;
  function find(nodes: FolderWithChildren[]): FolderWithChildren | null {
    for (const n of nodes) {
      if (n.id === parentId) return n;
      const sub = find(n.children ?? []);
      if (sub) return sub;
    }
    return null;
  }
  return find(tree)?.children ?? [];
}

/** Build the path from root to `folderId` as a list of {id, name}. Returns [] for null. */
export function buildBreadcrumb(
  tree: FolderWithChildren[],
  folderId: string | null
): { id: string; name: string }[] {
  if (!folderId) return [];
  const path: { id: string; name: string }[] = [];
  function dfs(nodes: FolderWithChildren[], trail: { id: string; name: string }[]): boolean {
    for (const n of nodes) {
      const next = [...trail, { id: n.id, name: n.name }];
      if (n.id === folderId) {
        path.push(...next);
        return true;
      }
      if (dfs(n.children ?? [], next)) return true;
    }
    return false;
  }
  dfs(tree, []);
  return path;
}

/** Ancestor path to `folderId` as text (excludes the folder itself). Empty for root-level. */
export function buildPathString(
  tree: FolderWithChildren[],
  folderId: string,
  separator = ' / '
): string {
  const crumbs = buildBreadcrumb(tree, folderId);
  return crumbs
    .slice(0, -1)
    .map((c) => c.name)
    .join(separator);
}

/**
 * Return the folder ID set of the subtree rooted at `rootId` (rootId + all descendants).
 * Returns an empty array if `rootId` is not found in `tree`.
 */
export function getDescendantFolderIds(
  tree: FolderWithChildren[],
  rootId: string
): string[] {
  function findRoot(nodes: FolderWithChildren[]): FolderWithChildren | null {
    for (const n of nodes) {
      if (n.id === rootId) return n;
      const sub = findRoot(n.children ?? []);
      if (sub) return sub;
    }
    return null;
  }
  const root = findRoot(tree);
  if (!root) return [];
  const ids: string[] = [];
  const visited = new Set<string>();
  function walk(n: FolderWithChildren): void {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    ids.push(n.id);
    for (const c of n.children ?? []) walk(c);
  }
  walk(root);
  return ids;
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
