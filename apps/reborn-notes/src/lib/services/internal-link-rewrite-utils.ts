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
 * Scope: relative path links `[x](../b.md)` and, when a wikilink index is
 * supplied (see {@link buildWikilinkIndex}), Obsidian `[[wikilinks]]` -
 * resolved by vault-relative path or unique basename. Reference-style
 * `[label][ref]` definitions and `![[embeds]]` (transclusions - reborn-notes
 * has no include semantics) are intentionally left untouched.
 *
 * Heading anchors: a `#fragment` on a path link (`b.md#section`) and a wikilink
 * heading subpath (`[[Doc#Heading]]`) are preserved as `note:UUID#slug`, where
 * `slug` is {@link slugifyHeading} of the fragment. Slugifying unifies both
 * GitHub-style fragments (already a slug -> slugifies to itself) and Obsidian
 * heading text (`#Heading Text` -> `heading-text`); MarkdownPreview stamps the
 * matching id on the target heading so the link lands on it. A same-note
 * Obsidian heading link (`[[#Heading]]`) becomes a plain in-note `[..](#slug)`
 * anchor. Block references (`#^block`) have no heading equivalent and drop to a
 * plain note link (cross-note) or are left as-is (same-note).
 */

import { slugifyHeading } from '$lib/utils/heading-outline';

/** Result of a rewrite pass: the new content and how many links were rewritten. */
export type LinkRewriteResult = { content: string; rewritten: number };

/**
 * Matches, in priority order:
 *  1. A backtick-delimited code span or fence (`` `inline` ``, ```` ```fenced``` ````):
 *     `(`+)[\s\S]*?\1` - the backreference forces a matching run length, so it
 *     covers both inline code and fenced blocks. Left untouched.
 *  2. A tilde-fenced code block (`~~~ ... ~~~`). Left untouched.
 *  3. An Obsidian wikilink: `(!?)[[inner]]`. The `!` marks an embed
 *     (transclusion) - left untouched; only plain `[[..]]` is a candidate, and
 *     only when a wikilink index was supplied. Matched BEFORE the inline-link
 *     alternative so `[[x]]` is not mis-read as `[label]` + stray `[x]`.
 *  4. An inline Markdown link or image: `(!?)[label](dest)`. The `!` marks an
 *     image (embed) - left untouched; only real links are candidates.
 *
 * Capture groups: 1 = code fence, 2 = wikilink bang, 3 = wikilink inner,
 * 4 = link bang, 5 = link label, 6 = link dest. The alternative that did not
 * match leaves its groups `undefined`, which the callback uses to dispatch.
 *
 * Negated character classes only (no nested quantifiers over overlapping
 * classes), so there is no catastrophic-backtracking risk on note-sized input.
 */
const TOKEN_RE =
  /(`+)[\s\S]*?\1|~~~[\s\S]*?~~~|(!?)\[\[([^[\]\n]+)\]\]|(!?)\[([^\]]*)\]\(([^)]+)\)/g;

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

// ── Obsidian wikilinks (`[[Target]]`) ───────────────────────────────────────

/**
 * Resolution index for Obsidian `[[wikilinks]]`, built once per import from the
 * importer's `relativePath → note id` map by {@link buildWikilinkIndex}.
 *
 *  - `byPath` - vault-relative path without extension (lowercased) → note id.
 *    Resolves the path form Obsidian emits to disambiguate (`[[folder/Note]]`,
 *    its "shortest unique path"). A full path names exactly one file, so this
 *    map is never ambiguous.
 *  - `byBasename` - file basename without extension (lowercased) → note id, but
 *    ONLY for basenames unique across the vault. A basename shared by two
 *    distinct notes is absent, so a bare ambiguous `[[Note]]` is left untouched
 *    (the agreed fallback) instead of guessing.
 */
export type WikilinkIndex = {
  byPath: Map<string, string>;
  byBasename: Map<string, string>;
};

/** First `/`-separated segment of a path (`a/b/c` → `a`; `c` → ''). */
function firstSegment(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/**
 * Build a {@link WikilinkIndex} from the importer's `relativePath → note id`
 * map. Obsidian resolves wikilinks against the VAULT ROOT (not the linking
 * file's directory), so paths are made vault-relative by stripping the common
 * root segment - the single selected directory of a folder import / folder
 * sync. When the keys don't share a first segment they are treated as already
 * vault-relative and nothing is stripped.
 *
 * Basenames are de-duplicated by note id first: one note carried under two
 * paths (a folder-sync manifest entry plus this run's path) is a single target,
 * not a collision. Only genuinely shared basenames (two distinct ids) drop out
 * of `byBasename`.
 */
export function buildWikilinkIndex(
  pathToNoteId: Map<string, string> | Record<string, string>
): WikilinkIndex {
  const map = pathToNoteId instanceof Map ? pathToNoteId : new Map(Object.entries(pathToNoteId));
  const keys = [...map.keys()];

  // Vault root = shared first segment, only when ALL keys share it.
  let root = '';
  if (keys.length > 0) {
    const candidate = firstSegment(keys[0]);
    if (candidate && keys.every((k) => firstSegment(k) === candidate)) root = candidate;
  }
  const toVaultRelative = (p: string): string =>
    root && (p === root || p.startsWith(`${root}/`)) ? p.slice(root.length + 1) : p;

  const byPath = new Map<string, string>();
  const basenameIds = new Map<string, Set<string>>();
  for (const [path, id] of map) {
    const rel = toVaultRelative(path)
      .replace(/\.md$/i, '')
      .toLowerCase();
    if (rel === '') continue;
    if (!byPath.has(rel)) byPath.set(rel, id);
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    const ids = basenameIds.get(base) ?? new Set<string>();
    ids.add(id);
    basenameIds.set(base, ids);
  }

  const byBasename = new Map<string, string>();
  for (const [base, ids] of basenameIds) {
    if (ids.size === 1) byBasename.set(base, [...ids][0]);
  }

  return { byPath, byBasename };
}

/**
 * Split a wikilink body (`Target#sub|alias`) into its parts. `target` is the
 * text before the first `#` (subpath) and first `|` (alias); `sub` is the
 * subpath after the first `#` (a heading name, or a `^block` reference - the
 * leading `^` is kept so the caller can tell them apart); `alias` is the display
 * override after `|`. An empty `target` means a same-note link (`[[#Heading]]`).
 */
function parseWikilink(inner: string): { target: string; sub: string; alias: string } {
  const pipeIdx = inner.indexOf('|');
  const beforePipe = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
  const alias = (pipeIdx === -1 ? '' : inner.slice(pipeIdx + 1)).trim();
  const hashIdx = beforePipe.indexOf('#');
  const target = (hashIdx === -1 ? beforePipe : beforePipe.slice(0, hashIdx)).trim();
  const sub = hashIdx === -1 ? '' : beforePipe.slice(hashIdx + 1).trim();
  return { target, sub, alias };
}

/**
 * Resolve a wikilink target to a note id against a {@link WikilinkIndex}. A
 * target containing `/` is a path form → exact vault-relative match only
 * (Obsidian does not basename-fall-back a path that doesn't exist). A bare
 * basename resolves via the unique-basename map (ambiguous → undefined → the
 * caller leaves the link untouched).
 */
function resolveWikilink(target: string, index: WikilinkIndex): string | undefined {
  const norm = target
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
  if (norm === '') return undefined;
  return norm.includes('/') ? index.byPath.get(norm) : index.byBasename.get(norm);
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
 * targets, code spans, and unresolved targets are left untouched. A `#fragment`
 * is preserved as a `note:UUID#slug` heading anchor (slugified - see file
 * header); a `#^block` reference, having no heading equivalent, is dropped.
 *
 * @param opts.wikilinks Optional {@link WikilinkIndex}. When supplied, Obsidian
 *                       `[[Target]]` / `[[Target|alias]]` / `[[Target#Heading]]`
 *                       links are also rewritten (target resolved by
 *                       vault-relative path or unique basename; a `#Heading`
 *                       subpath becomes `note:UUID#slug`, `#^block` is dropped,
 *                       and a same-note `[[#Heading]]` becomes `[..](#slug)`).
 *                       `![[embeds]]` stay untouched. Without it, every `[[..]]`
 *                       is left as-is (the path-link-only behavior).
 */
export function rewriteInterNoteLinks(
  content: string,
  currentRelativePath: string,
  pathToNoteId: Map<string, string> | Record<string, string>,
  opts?: { wikilinks?: WikilinkIndex }
): LinkRewriteResult {
  const map = pathToNoteId instanceof Map ? pathToNoteId : new Map(Object.entries(pathToNoteId));
  const wikilinks = opts?.wikilinks;
  if (map.size === 0 && wikilinks === undefined) return { content, rewritten: 0 };

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
    (
      match,
      codeFence: string | undefined,
      wikiBang: string | undefined,
      wikiInner: string | undefined,
      bang: string | undefined,
      label: string,
      dest: string
    ): string => {
      // Group 1 set → backtick code span/fence; tilde fence has no capture but
      // starts with `~~~`. Either way it is code: leave verbatim.
      if (codeFence !== undefined || match.startsWith('~~~')) return match;

      // Obsidian wikilink `[[Target]]` / `[[Target|alias]]` / `[[Target#Heading]]`
      // (group 3 set). Only rewritten when an index was supplied; `![[embed]]`
      // (transclusion) and unresolved/ambiguous targets are left as-is.
      if (wikiInner !== undefined) {
        if (wikilinks === undefined || wikiBang === '!') return match;
        const { target, sub, alias } = parseWikilink(wikiInner);
        // A `#^block` reference has no heading equivalent; only a `#heading`
        // subpath maps to an anchor.
        const headingSub = sub && !sub.startsWith('^') ? sub : '';

        // Same-note heading link `[[#Heading]]` (empty target) -> in-note anchor.
        // `[[#^block]]` / bare `[[#]]` have nothing to resolve; left as-is.
        if (target === '') {
          if (headingSub === '') return match;
          rewritten++;
          return `[${alias || sub}](#${slugifyHeading(headingSub)})`;
        }

        const noteId = resolveWikilink(target, wikilinks);
        if (noteId === undefined) return match;
        rewritten++;
        const anchor = headingSub ? `#${slugifyHeading(headingSub)}` : '';
        return `[${alias || target}](note:${noteId}${anchor})`;
      }

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

      // Split off the #fragment, then percent-decode the path.
      const hashIdx = rawUrl.indexOf('#');
      const pathPart = hashIdx === -1 ? rawUrl : rawUrl.slice(0, hashIdx);
      const fragment = hashIdx === -1 ? '' : rawUrl.slice(hashIdx + 1);
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

      // Preserve a heading anchor. The fragment may be a GitHub-style slug or
      // Obsidian heading text; slugifyHeading maps both to the id MarkdownPreview
      // stamps on the heading (a slug slugifies to itself).
      let anchor = '';
      if (fragment) {
        let decodedFragment: string;
        try {
          decodedFragment = decodeURIComponent(fragment);
        } catch {
          decodedFragment = fragment;
        }
        const slug = slugifyHeading(decodedFragment);
        if (slug) anchor = `#${slug}`;
      }

      rewritten++;
      return `[${label}](note:${noteId}${anchor}${title})`;
    }
  );

  return { content: newContent, rewritten };
}
