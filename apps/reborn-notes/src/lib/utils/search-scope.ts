/**
 * Scope composition for "Save search" from scoped views.
 *
 * A saved search is a global query, but the search input in folder / tag /
 * starred views filters WITHIN that view. Saving the bare input text there
 * would create a view returning different (global) results than what the
 * user is looking at. Composing the view scope into the query as a regular
 * operator keeps the "you save what you see" contract - and doubles as a
 * gentle introduction to the operator language, since the dialog previews
 * the composed query verbatim.
 *
 * Folder scope relies on the `folder:` operator matching the whole subtree
 * (folder + descendants), exactly like the folder view does - see the
 * `folderPathById` note in @reborn/utils SearchContext.
 */
export type SaveScope =
  | { kind: 'folder'; folderId: string; folderName: string; path: string }
  | { kind: 'tag'; name: string }
  | { kind: 'starred' };

export function scopeOperatorPrefix(scope: SaveScope | null): string {
  if (!scope) return '';
  switch (scope.kind) {
    case 'folder':
      // Always quoted: paths may contain spaces; quoting is harmless otherwise.
      return `folder:"${scope.path}"`;
    case 'tag':
      return `tag:"${scope.name}"`;
    case 'starred':
      return 'is:starred';
  }
}

/** Final query string persisted by the save dialog (shown 1:1 in its preview). */
export function composeScopedQuery(scope: SaveScope | null, query: string): string {
  const prefix = scopeOperatorPrefix(scope);
  const trimmed = query.trim();
  if (!prefix) return trimmed;
  return trimmed ? `${prefix} ${trimmed}` : prefix;
}
