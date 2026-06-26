/**
 * Shared, surface-agnostic matcher for the in-note "find in note" feature.
 *
 * Both backends - the CodeMirror editor ({@link ../editor/note-search}) and the
 * rendered Markdown preview ({@link ./note-search-dom}) - feed their text through
 * {@link findMatches} so the search semantics (case folding, escaping, the match
 * cap) stay identical no matter which view mode is active. Search runs entirely
 * client-side over already-decrypted, in-memory content; nothing is sent to or
 * logged on the server.
 */

export interface SearchMatch {
  /** Start offset (inclusive) into the searched text. */
  from: number;
  /** End offset (exclusive) into the searched text. */
  to: number;
}

/**
 * Hard cap on highlighted matches. Keeps decoration/range building cheap on
 * pathological queries (e.g. a single common letter in a large note). When the
 * cap is hit the caller surfaces the count as "capped" (e.g. `2000+`).
 */
export const NOTE_SEARCH_MATCH_CAP = 2000;

/** Escape a user string so it is matched literally inside a RegExp. */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find non-overlapping matches of `query` in `text`, case-insensitive unless
 * `caseSensitive` is set.
 *
 * Matches against the ORIGINAL text via a RegExp rather than lower-casing both
 * sides: `String.prototype.toLowerCase()` can change length under Unicode case
 * folding (e.g. `İ`), which would shift offsets and misalign CodeMirror
 * decorations / DOM ranges. A regex match reports indices into the original
 * string, so offsets always line up. Returns at most
 * {@link NOTE_SEARCH_MATCH_CAP} matches.
 */
export function findMatches(text: string, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return [];
  let re: RegExp;
  try {
    re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
  } catch {
    return [];
  }
  const matches: SearchMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // A non-empty query can't yield a zero-length match, but advancing past a
    // zero-length lastIndex anyway guards against an infinite loop if that
    // invariant ever changes.
    if (m.index === re.lastIndex) re.lastIndex++;
    matches.push({ from: m.index, to: m.index + m[0].length });
    if (matches.length >= NOTE_SEARCH_MATCH_CAP) break;
  }
  return matches;
}

/** A half-open `[from, to)` source span. */
export interface SearchSpan {
  from: number;
  to: number;
}

/**
 * Drop matches that overlap any span in `excluded`.
 *
 * Used in Live Preview to hide matches that fall in source ranges the editor
 * renders away (e.g. the `#slug` inside a managed TOC's `](#slug)` link target -
 * a kebab-case dup of the heading the reader never sees). Filtering keeps the
 * match count and prev/next navigation aligned with what is actually visible, so
 * the user never lands on an "invisible" hit. A match overlaps a span when their
 * half-open ranges intersect (`from < span.to && to > span.from`).
 */
export function excludeMatchesInSpans(
  matches: SearchMatch[],
  excluded: SearchSpan[]
): SearchMatch[] {
  if (!excluded.length) return matches;
  return matches.filter((m) => !excluded.some((s) => m.from < s.to && m.to > s.from));
}
