/**
 * Which folders are in the archive, derived from the decrypted folder tree.
 *
 * A folder is archived by a marker in its own encrypted metadata
 * (`archived_at`, see services/archive-marker.ts). The marker covers the whole
 * subtree: the folder, its subfolders and every note inside them are in the
 * archive, and nothing is moved. So "is this in the archive?" is a walk up the
 * tree, done once here per tree refresh and handed to the note index.
 *
 * Pure functions, no stores - the folder store and the tests call them.
 */
import type { FolderWithChildren } from '@reborn/types';

/** Why a folder is in the archive: the topmost archived folder above (or at) it. */
export interface ArchivedFolderInfo {
  /** Id of the topmost archived folder - the row the Archive view shows. */
  rootId: string;
  /** That folder's marker: when the subtree was archived. */
  at: string;
}

/** Every archived folder id (archived folders and all their descendants). */
export type ArchivedFolderScope = ReadonlyMap<string, ArchivedFolderInfo>;

/** An archived folder with no archived folder above it. */
export interface ArchiveRoot {
  folder: FolderWithChildren;
  /** Names of the folders above it, outermost first (they are active). */
  path: string[];
  /** The folder and all its descendants. */
  folderIds: string[];
  at: string;
}

/**
 * Map every folder that is in the archive to its topmost archived ancestor.
 * A folder archived inside an already archived folder keeps pointing at the
 * outer one: restoring the outer folder leaves the inner one archived, and it
 * then becomes a root of its own.
 */
export function buildArchivedFolderScope(
  tree: FolderWithChildren[]
): Map<string, ArchivedFolderInfo> {
  const scope = new Map<string, ArchivedFolderInfo>();
  const visited = new Set<string>();
  function walk(nodes: FolderWithChildren[], inherited: ArchivedFolderInfo | undefined): void {
    for (const node of nodes) {
      if (visited.has(node.id)) continue; // defensive: a cyclic tree must not hang
      visited.add(node.id);
      const info =
        inherited ?? (node.archived_at ? { rootId: node.id, at: node.archived_at } : undefined);
      if (info) scope.set(node.id, info);
      walk(node.children ?? [], info);
    }
  }
  walk(tree, undefined);
  return scope;
}

/**
 * The tree the app works with day to day: archived folders and everything
 * below them removed. Returns the input itself when nothing is archived, so
 * the common case allocates nothing.
 */
export function pruneArchivedFolders(tree: FolderWithChildren[]): FolderWithChildren[] {
  function prune(nodes: FolderWithChildren[]): FolderWithChildren[] {
    let same = true;
    const out: FolderWithChildren[] = [];
    for (const node of nodes) {
      if (node.archived_at) {
        same = false;
        continue;
      }
      const children = node.children ?? [];
      const kept = prune(children);
      if (kept === children) {
        out.push(node);
      } else {
        same = false;
        out.push({ ...node, children: kept });
      }
    }
    return same ? nodes : out;
  }
  return prune(tree);
}

/** The rows of the Archive view's folder section, in tree order. */
export function listArchiveRoots(tree: FolderWithChildren[]): ArchiveRoot[] {
  const roots: ArchiveRoot[] = [];
  function collectIds(node: FolderWithChildren, ids: string[], seen: Set<string>): void {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ids.push(node.id);
    for (const child of node.children ?? []) collectIds(child, ids, seen);
  }
  function walk(nodes: FolderWithChildren[], path: string[]): void {
    for (const node of nodes) {
      if (node.archived_at) {
        const folderIds: string[] = [];
        collectIds(node, folderIds, new Set());
        roots.push({ folder: node, path, folderIds, at: node.archived_at });
        continue; // archived folders below belong to this root
      }
      walk(node.children ?? [], [...path, node.name]);
    }
  }
  walk(tree, []);
  return roots;
}

/** True when two scopes mark the same folders with the same roots and dates. */
export function sameArchivedFolderScope(a: ArchivedFolderScope, b: ArchivedFolderScope): boolean {
  if (a.size !== b.size) return false;
  for (const [id, info] of a) {
    const other = b.get(id);
    if (!other || other.rootId !== info.rootId || other.at !== info.at) return false;
  }
  return true;
}

/** The folder and every folder below it. */
export function collectFolderIds(folder: FolderWithChildren): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  function walk(node: FolderWithChildren): void {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ids.push(node.id);
    for (const child of node.children ?? []) walk(child);
  }
  walk(folder);
  return ids;
}

/** Why a folder cannot be archived. */
export type FolderArchiveBlock = 'periodic' | 'sync';

/**
 * A folder cannot be archived while something keeps writing into its subtree
 * on its own: the Periodic Notes feature (it would go on creating today's
 * note inside a hidden folder) or a folder-sync destination (the sync would
 * add notes nobody sees). Returns the reason, or null when archiving is fine.
 */
export function folderArchiveBlock(
  subtreeIds: string[],
  periodicFolderIds: Iterable<string | null | undefined>,
  syncedFolderIds: Iterable<string>
): FolderArchiveBlock | null {
  const subtree = new Set(subtreeIds);
  for (const id of periodicFolderIds) if (id && subtree.has(id)) return 'periodic';
  for (const id of syncedFolderIds) if (subtree.has(id)) return 'sync';
  return null;
}
