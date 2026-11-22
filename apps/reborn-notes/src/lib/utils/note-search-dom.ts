/**
 * Rendered-preview (DOM) backend for the in-note "find in note" feature.
 *
 * Highlights matches in the rendered Markdown without mutating its DOM, using
 * the CSS Custom Highlight API (`CSS.highlights` + `Highlight` ranges). Not
 * touching the DOM matters: the preview re-renders via `{@html}` on every edit /
 * checkbox toggle, and injected wrapper elements would be wiped (and would fight
 * the renderer). The host recomputes ranges after each render instead.
 *
 * The preview is searched as RENDERED text, so a query matches what the reader
 * sees (e.g. `bold`), not the Markdown source (`**bold**`) - the editor backend
 * covers source search. Ranges may span inline element boundaries (bold/links).
 */
import { findMatches, NOTE_SEARCH_MATCH_CAP } from './note-search-core';

const HL_ALL = 'note-search';
const HL_ACTIVE = 'note-search-active';
/**
 * Separate highlight name for matches painted INSIDE Live Preview block widgets
 * (TOC / table / code) by the CodeMirror editor's widget highlighter. Kept
 * distinct from {@link HL_ALL} so the editor's `clearDomHighlights()` (run on
 * every editor-mode repaint) can wipe the rendered-preview highlights without
 * touching the widget ones, and vice versa - the two backends never stomp each
 * other even though both write to the document-global `CSS.highlights`.
 */
const HL_WIDGET = 'note-search-wgt';
/** Active-match variant of {@link HL_WIDGET} (the strong/orange emphasis). */
const HL_WIDGET_ACTIVE = 'note-search-wgt-active';

/** Whether the browser supports the CSS Custom Highlight API (painting). */
export function supportsHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/**
 * Invisible paint-only style that {@link nudgeRepaint} toggles. Any change of
 * `background-image` makes the engine repaint the element's whole box; a
 * transparent gradient draws nothing in either theme.
 */
const REPAINT_NUDGE = 'linear-gradient(transparent, transparent)';
const nudgeQueued = new WeakSet<HTMLElement>();

/**
 * Repaint `el` (and everything inside it) on the next frame.
 *
 * Why: WebKit (Safari, the desktop shell) does not repaint the text a highlight
 * is taken OFF. Replacing a name with `CSS.highlights.set` left every range of
 * the previous query painted (smoke D1, 2026-11-21: after "a" -> "aa" -> "aaa"
 * the counter said 1/1 while all the "a"s still glowed), although the registry
 * held only the current ranges. Deleting the name before setting it cleaned
 * most of it but left slivers above bold text, where the highlight box is
 * taller than the area WebKit repaints. A style change on the container
 * repaints its whole box, which cleared all of it (checked in Safari's Web
 * Inspector on the localprod image before this code was written). Brave
 * (Chromium) left stale paint too; there an own layer for the preview helped,
 * which did nothing in Safari, so the nudge is the one fix for both.
 *
 * Coalesced to one toggle per element per frame: two toggles in one frame
 * would cancel out and repaint nothing.
 */
export function nudgeRepaint(el: HTMLElement | null | undefined): void {
  if (!el || nudgeQueued.has(el) || typeof requestAnimationFrame !== 'function') return;
  nudgeQueued.add(el);
  requestAnimationFrame(() => {
    nudgeQueued.delete(el);
    el.style.backgroundImage = el.style.backgroundImage ? '' : REPAINT_NUDGE;
  });
}

interface NodeOffset {
  node: Text;
  /** Index in the concatenated text where this node's data begins. */
  start: number;
}

/**
 * Build DOM Ranges for every match of `query` in `root`'s rendered text.
 *
 * Concatenates all text nodes (with a per-node start-offset map), runs the
 * shared {@link findMatches} over the joined string, then maps each global
 * offset back to its `(textNode, offset)` via binary search - so a match that
 * crosses inline boundaries still yields one continuous Range. Capped at
 * {@link NOTE_SEARCH_MATCH_CAP}.
 */
export function findDomMatchRanges(
  root: HTMLElement | null,
  query: string,
  caseSensitive: boolean
): Range[] {
  if (!query || !root) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const offsets: NodeOffset[] = [];
  let full = '';
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    if (!textNode.data) continue;
    offsets.push({ node: textNode, start: full.length });
    full += textNode.data;
  }
  if (!offsets.length) return [];

  const matches = findMatches(full, query, caseSensitive);

  // Map a global offset into the concatenated text back to its text node.
  const locate = (globalIdx: number): { node: Text; offset: number } => {
    let lo = 0;
    let hi = offsets.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid].start <= globalIdx) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { node: offsets[ans].node, offset: globalIdx - offsets[ans].start };
  };

  const ranges: Range[] = [];
  for (const m of matches) {
    const s = locate(m.from);
    const e = locate(m.to);
    try {
      const range = document.createRange();
      range.setStart(s.node, Math.min(s.offset, s.node.length));
      range.setEnd(e.node, Math.min(e.offset, e.node.length));
      ranges.push(range);
    } catch {
      /* Skip ranges the DOM rejects (e.g. node detached mid-render). */
    }
    if (ranges.length >= NOTE_SEARCH_MATCH_CAP) break;
  }
  return ranges;
}

/**
 * Paint `ranges` as the base highlight and the `active`-th as the strong
 * highlight. The active range is kept OUT of the base set so the two
 * `::highlight()` styles don't blend where they'd overlap. No-op without API
 * support (matches still navigate/scroll; only the paint is skipped).
 *
 * `repaintRoot` is the element holding the ranges (the rendered preview); it is
 * repainted so the previous query's highlights don't stay on screen, see
 * {@link nudgeRepaint}.
 */
export function paintDomHighlights(
  ranges: Range[],
  active: number,
  repaintRoot?: HTMLElement | null
): void {
  if (!supportsHighlightApi()) return;
  const base = new Highlight();
  let activeRange: Range | null = null;
  ranges.forEach((range, i) => {
    if (i === active) activeRange = range;
    else base.add(range);
  });
  CSS.highlights.set(HL_ALL, base);
  if (activeRange) {
    const strong = new Highlight();
    strong.add(activeRange);
    CSS.highlights.set(HL_ACTIVE, strong);
  } else {
    CSS.highlights.delete(HL_ACTIVE);
  }
  nudgeRepaint(repaintRoot);
}

/**
 * Remove both in-note search highlights from the registry. Pass the element
 * that showed them (`repaintRoot`) when they may be on screen, so they are
 * actually wiped, see {@link nudgeRepaint}.
 */
export function clearDomHighlights(repaintRoot?: HTMLElement | null): void {
  if (!supportsHighlightApi()) return;
  CSS.highlights.delete(HL_ALL);
  CSS.highlights.delete(HL_ACTIVE);
  nudgeRepaint(repaintRoot);
}

/**
 * Paint matches found inside Live Preview block widgets: `base` under the
 * {@link HL_WIDGET} name and the `active` range (if any) under
 * {@link HL_WIDGET_ACTIVE}. These ranges live in the editor's widget DOM, which
 * CodeMirror's mark decorations can't reach (the source is replaced by generated
 * DOM); the CSS Custom Highlight API is the only way to colour them without
 * mutating widget markup. The active range is kept OUT of `base` by the caller so
 * the two `::highlight()` styles don't blend. Empty input clears each layer.
 *
 * `repaintRoots` are the widget roots in the editor; each is repainted so the
 * previous query's highlights don't stay on screen, see {@link nudgeRepaint}.
 */
export function paintWidgetHighlights(
  base: Range[],
  active: Range | null,
  repaintRoots: Iterable<HTMLElement> = []
): void {
  if (!supportsHighlightApi()) return;
  if (base.length) {
    const hl = new Highlight();
    for (const range of base) hl.add(range);
    CSS.highlights.set(HL_WIDGET, hl);
  } else {
    CSS.highlights.delete(HL_WIDGET);
  }
  if (active) {
    const hl = new Highlight();
    hl.add(active);
    CSS.highlights.set(HL_WIDGET_ACTIVE, hl);
  } else {
    CSS.highlights.delete(HL_WIDGET_ACTIVE);
  }
  for (const root of repaintRoots) nudgeRepaint(root);
}

/** Remove both Live Preview widget search highlights from the registry. */
export function clearWidgetHighlights(): void {
  if (!supportsHighlightApi()) return;
  CSS.highlights.delete(HL_WIDGET);
  CSS.highlights.delete(HL_WIDGET_ACTIVE);
}

/**
 * Scroll `scrollEl` so `range` is centered. Falls back to the match's parent
 * element when the scroll container is unknown or the range has no box yet
 * (e.g. zero-size during a re-render).
 */
export function scrollDomRangeIntoView(scrollEl: HTMLElement | null, range: Range): void {
  const fallback = () =>
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (!scrollEl) {
    fallback();
    return;
  }
  const cr = range.getBoundingClientRect();
  if (cr.height === 0 && cr.width === 0) {
    fallback();
    return;
  }
  const sr = scrollEl.getBoundingClientRect();
  const delta = cr.top - sr.top - (scrollEl.clientHeight / 2 - cr.height / 2);
  scrollEl.scrollBy({ top: delta, behavior: 'smooth' });
}
