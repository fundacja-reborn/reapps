/**
 * Pure helper for rewriting relative Markdown links between imported files into
 * reborn-notes internal note links (`note:UUID`).
 *
 * When a vault of `.md` files is imported (one-shot folder import or live folder
 * sync), files commonly link to each other with standard relative Markdown
 * links: `[label](../other/note.md)`. Those targets mean nothing inside the app
 * - reborn-notes navigates by `[label](note:UUID)` (see guideline 28). This
 * helper resolves each relative `.md` target against the importer's
 * `relativePath → note id` map and rewrites it in place.
 *
 * Design constraints (why this is string surgery, not an AST round-trip):
 *  - The result is compared byte-for-byte against the stored note by the
 *    importer's `unchanged` check. Re-serializing through a Markdown parser
 *    would reflow the whole document and make every synced file look "changed"
 *    on every run. So we touch ONLY the matched link destinations and leave all
 *    other bytes identical.
 *  - The transform must be idempotent: a `note:UUID` link has the `note:`
 *    scheme, so a second pass skips it (scheme check below). This is what lets
 *    live folder sync re-apply the rewrite on every run without thrashing.
 *
 * Scope (v1): relative path links only. Obsidian `[[wikilinks]]` and
 * reference-style `[label][ref]` definitions are intentionally left untouched.
 */

/** Result of a rewrite pass: the new content and how many links were rewritten. */
export type LinkRewriteResult = { content: string; rewritten: number };

/**
 * Matches, in priority order:
 *  1. A backtick-delimited code span or fence (`` `inline` ``, ```` ```fenced``` ````):
 *     `(`+)[\s\S]*?\1` - the backreference forces a matching run length, so it
 *     covers both inline code and fenced blocks. Left untouched.
 *  2. A tilde-fenced code block (`~~~ ... ~~~`). Left untouched.
 *  3. An inline Markdown link or image: `(!?)[label](dest)`. The `!` marks an
 *     image (embed) - left untouched; only real links are candidates.
 *
 * Negated character classes only (no nested quantifiers over overlapping
 * classes), so there is no catastrophic-backtracking risk on note-sized input.
 */
const TOKEN_RE = /(`+)[\s\S]*?\1|~~~[\s\S]*?~~~|(!?)\[([^\]]*)\]\(([^)]+)\)/g;

/** A destination has a URI scheme (`http:`, `mailto:`, `note:`, …). */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Normalize a `/`-separated path, resolving `.` and `..` segments. Leading
 * `..` that would escape the root are dropped (the result then won't match any
 * map key, so the link is left as-is). No leading slash is produced.
 */
function normalizeRelativePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/** Directory portion of a `/`-separated relative file path (`a/b/c.md` → `a/b`). */
function dirOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/');
  return idx === -1 ? '' : relativePath.slice(0, idx);
}

/** Strip a single pair of surrounding angle brackets (`<url>` → `url`). */
function stripAngleBrackets(url: string): string {
  return url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;
}

/**
 * Rewrite relative `.md` links in `content` to `note:UUID` links using the
 * importer's path→note-id map.
 *
 * @param content            Note body (frontmatter already stripped).
 * @param currentRelativePath Path of THIS note's source file, in the same shape
 *                            as the map keys (`<root>/<sub>/<file.md>`). Relative
 *                            link targets resolve against its directory.
 * @param pathToNoteId        Map from source relative path to the note id it was
 *                            imported into. Lookup is exact first, then
 *                            case-insensitive (covers case-insensitive file
 *                            systems and Obsidian's case-insensitive resolution).
 *
 * A link is rewritten only when its target resolves to a known note. Images
 * (`![..](..)`), external/`note:`/anchor-only/absolute destinations, non-`.md`
 * targets, code spans, and unresolved targets are left untouched. Any
 * `#fragment` is dropped (the `note:` scheme has no heading anchors yet).
 */
export function rewriteInterNoteLinks(
  content: string,
  currentRelativePath: string,
  pathToNoteId: Map<string, string> | Record<string, string>
): LinkRewriteResult {
  const map = pathToNoteId instanceof Map ? pathToNoteId : new Map(Object.entries(pathToNoteId));
  if (map.size === 0) return { content, rewritten: 0 };

  // Case-insensitive fallback index, built once. Exact match wins so a vault
  // with case-distinct files on a case-sensitive FS still resolves precisely.
  const lowerIndex = new Map<string, string>();
  for (const [key, id] of map) {
    const lower = key.toLowerCase();
    if (!lowerIndex.has(lower)) lowerIndex.set(lower, id);
  }

  const currentDir = dirOf(currentRelativePath);
  let rewritten = 0;

  const resolveId = (target: string): string | undefined => {
    const exact = map.get(target);
    if (exact !== undefined) return exact;
    return lowerIndex.get(target.toLowerCase());
  };

  const newContent = content.replace(
    TOKEN_RE,
    (match, codeFence: string | undefined, bang: string | undefined, label: string, dest: string): string => {
      // Group 1 set → backtick code span/fence; tilde fence has no capture but
      // starts with `~~~`. Either way it is code: leave verbatim.
      if (codeFence !== undefined || match.startsWith('~~~')) return match;
      // Image / embed (`![..](..)`): not a navigable link.
      if (bang === '!') return match;

      // Split destination into URL and an optional title ("..."/'...').
      const destMatch = dest.match(/^\s*(<[^>]*>|\S+)(\s+.*)?$/);
      if (!destMatch) return match;
      const rawUrl = stripAngleBrackets(destMatch[1].trim());
      const title = destMatch[2] ?? '';

      // Skip destinations we must not touch: schemes (http:, note:, …), pure
      // anchors, and absolute paths (not resolvable in the vault namespace).
      if (rawUrl === '' || SCHEME_RE.test(rawUrl) || rawUrl.startsWith('#') || rawUrl.startsWith('/'))
        return match;

      // Drop any #fragment, then percent-decode the path.
      const hashIdx = rawUrl.indexOf('#');
      const pathPart = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx);
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        decoded = pathPart;
      }
      if (!decoded.toLowerCase().endsWith('.md')) return match;

      const resolved = normalizeRelativePath(`${currentDir}/${decoded}`);
      const noteId = resolveId(resolved);
      if (noteId === undefined) return match;

      rewritten++;
      return `[${label}](note:${noteId}${title})`;
    }
  );

  return { content: newContent, rewritten };
}
