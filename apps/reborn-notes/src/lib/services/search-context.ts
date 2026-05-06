/**
 * Build a SearchContext for the operator-based search evaluator.
 *
 * Reads from in-memory stores synchronously — `tagsStore` already holds
 * decrypted TagDecrypted[] and `foldersStore` holds the decrypted folder tree.
 * No IndexedDB hit, no decryption: the context is rebuilt per query and is
 * cheap (linear in tag count + folder count, both small).
 */
import { get } from 'svelte/store';
import type { FolderWithChildren } from '@reborn/types';
import type { SearchContext } from '@reborn/utils';
import { tagsStore } from '$lib/stores/tags.store';
import { foldersStore } from '$lib/stores/folders.store';

export function buildSearchContext(now: Date = new Date()): SearchContext {
  const tagIdByName = new Map<string, string>();
  for (const tag of get(tagsStore)) {
    if (tag.name) tagIdByName.set(tag.name.toLowerCase(), tag.id);
  }

  const folderIdByPath = new Map<string, string>();
  collectFolderPaths(get(foldersStore), [], folderIdByPath);

  return {
    tagIdByName,
    folderIdByPath,
    listIdByName: new Map(),
    now
  };
}

function collectFolderPaths(
  nodes: FolderWithChildren[],
  trail: string[],
  out: Map<string, string>
): void {
  for (const node of nodes) {
    const segment = node.name.toLowerCase();
    const path = [...trail, segment];
    out.set(path.join('/'), node.id);
    if (node.children?.length) {
      collectFolderPaths(node.children, path, out);
    }
  }
}
