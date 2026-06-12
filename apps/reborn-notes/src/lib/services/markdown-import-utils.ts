/**
 * Pure helpers for Markdown folder/file import.
 *
 * These functions have no side effects and no dependencies on stores,
 * crypto, or IndexedDB — they live in their own module so they can be
 * unit-tested in isolation without mocking the whole service graph.
 */

export type ParsedMarkdown = {
  title: string | null;
  content: string;
  tags: string[];
  created: string | null;
  modified: string | null;
};

/**
 * Parse YAML frontmatter and content from a raw markdown string.
 *
 * Extracts:
 *  - `title` (string) — fallback to filename happens at the callsite
 *  - `tags` (string[]) — supports inline `tags: [a, b]` and YAML list form
 *  - `created` / `date` — first match wins (both are common in Obsidian)
 *  - `modified` / `updated` — first match wins
 *
 * Regex-based (no js-yaml dependency). Unknown frontmatter properties are
 * stripped from the note body along with the frontmatter block.
 */
export function parseMarkdownFile(raw: string): ParsedMarkdown {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = raw.match(fmRegex);
  if (!match) {
    return { title: null, content: raw, tags: [], created: null, modified: null };
  }

  const fm = match[1];
  const content = raw.slice(match[0].length);

  const titleMatch = fm.match(/^title:\s*"?(.+?)"?\s*$/m);
  const title = titleMatch ? titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : null;

  // Tags — two supported forms:
  //   tags: [foo, "bar baz", 'qux']
  //   tags:
  //     - foo
  //     - "bar baz"
  const tags: string[] = [];
  const inlineTagsMatch = fm.match(/^tags:\s*\[(.*?)\]\s*$/m);
  if (inlineTagsMatch) {
    for (const item of inlineTagsMatch[1].split(',')) {
      const cleaned = item.trim().replace(/^["']|["']$/g, '').trim();
      if (cleaned) tags.push(cleaned);
    }
  } else {
    const listMatch = fm.match(/^tags:\s*\n((?:[ \t]*-[ \t]*.+(?:\r?\n|$))+)/m);
    if (listMatch) {
      for (const line of listMatch[1].split(/\r?\n/)) {
        const itemMatch = line.match(/^[ \t]*-[ \t]*(.+?)\s*$/);
        if (itemMatch) {
          const cleaned = itemMatch[1].replace(/^["']|["']$/g, '').trim();
          if (cleaned) tags.push(cleaned);
        }
      }
    }
  }

  // Dates — accept common Obsidian/Jekyll aliases. ISO / RFC 3339 expected;
  // normalization (parse + toISOString) happens at the import callsite.
  const createdMatch = fm.match(/^(?:created|date):\s*"?(.+?)"?\s*$/m);
  const modifiedMatch = fm.match(/^(?:modified|updated):\s*"?(.+?)"?\s*$/m);
  const created = createdMatch ? createdMatch[1].trim() : null;
  const modified = modifiedMatch ? modifiedMatch[1].trim() : null;

  return { title, content, tags, created, modified };
}

/**
 * Split `file.webkitRelativePath` into folder segments, stripping the last
 * segment (the filename) and - by default - the first segment (the root
 * directory the user selected: its contents are imported, not the container).
 *
 * `keepRoot: true` preserves that first segment, so the selected directory
 * itself becomes a folder in the imported tree (used by the "keep top-level
 * folder" import option).
 *
 * Examples (default):
 *   "MyVault/Projects/Web/note.md"  → ["Projects", "Web"]
 *   "MyVault/note.md"               → []
 *   ""                              → []
 * Examples (keepRoot):
 *   "MyVault/Projects/Web/note.md"  → ["MyVault", "Projects", "Web"]
 *   "MyVault/note.md"               → ["MyVault"]
 */
export function extractFolderSegments(relativePath: string, keepRoot = false): string[] {
  const parts = (relativePath || '').split('/').filter(Boolean);
  const start = keepRoot ? 0 : 1;
  if (parts.length - 1 <= start) return [];
  return parts.slice(start, -1);
}

/** Minimal structural slice of `File` used by the pure pre-filter helpers. */
export type ImportFileLike = {
  name: string;
  webkitRelativePath?: string;
};

/**
 * Name of the root directory the user picked, read from the first available
 * `webkitRelativePath`. Returns `null` when no file carries a relative path
 * (defensive - a `webkitdirectory` input always populates it in practice).
 */
export function getRootFolderName(files: ImportFileLike[]): string | null {
  for (const f of files) {
    const first = (f.webkitRelativePath || '').split('/').filter(Boolean)[0];
    if (first) return first;
  }
  return null;
}

/**
 * Mirror of the importer's pre-filter pipeline (hidden directories + `.md`
 * extension), used to show an honest "X notes ready to import" preview
 * before the user commits to a duplicate strategy. The per-file size cap is
 * intentionally not mirrored here - the importer reports `skippedTooLarge`
 * in its result instead.
 */
export function countImportableMarkdownFiles(files: ImportFileLike[]): number {
  let count = 0;
  for (const f of files) {
    if (containsHiddenSegment(f.webkitRelativePath ?? '')) continue;
    if (!f.name.toLowerCase().endsWith('.md')) continue;
    count++;
  }
  return count;
}

/**
 * Returns true if the path (after the root vault directory) contains any
 * segment starting with `.` — used to skip Obsidian/plugin dirs like
 * `.obsidian/`, `.trash/`, or any intentionally-hidden subfolder.
 *
 * The root (parts[0]) is skipped intentionally: if the user deliberately
 * picked a hidden directory as their vault, we honor that choice.
 */
export function containsHiddenSegment(relativePath: string): boolean {
  const parts = (relativePath || '').split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith('.')) return true;
  }
  return false;
}

/** Normalize a frontmatter date string to ISO 8601. Returns null on parse failure. */
export function normalizeFrontmatterDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Choose the best available created/modified timestamps for an imported file.
 *
 * Cascade:
 *  1. Frontmatter `created` / `modified` (and aliases — see {@link parseMarkdownFile})
 *  2. `file.lastModified` (filesystem mtime — only modification time, but
 *     dramatically better than "all imported notes share the same `now`",
 *     because the relative ordering between files is preserved)
 *  3. `undefined` — caller falls back to current time
 *
 * `file.lastModified === 0` is treated as "no info" (some browsers return 0
 * for files without metadata, e.g. clipboard-pasted content).
 *
 * Returns `undefined` for both fields when neither source yields a timestamp;
 * the caller then lets {@link createNote} apply its `now` default.
 */
export function pickImportTimestamps(
  parsed: { created: string | null; modified: string | null },
  fileLastModifiedMs: number
): { createdAt: string | undefined; modifiedAt: string | undefined } {
  const fmCreated = normalizeFrontmatterDate(parsed.created);
  const fmModified = normalizeFrontmatterDate(parsed.modified);
  const mtimeFallback =
    fileLastModifiedMs > 0 ? new Date(fileLastModifiedMs).toISOString() : undefined;

  return {
    createdAt: fmCreated ?? mtimeFallback,
    modifiedAt: fmModified ?? mtimeFallback
  };
}
