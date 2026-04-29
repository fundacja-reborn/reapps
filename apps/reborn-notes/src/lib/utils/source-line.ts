/**
 * Maps rendered preview blocks back to their source-line numbers so the
 * editor ↔ preview scroll position can stay aligned across mode toggles
 * and within split view.
 *
 * Pipeline: `marked.lexer(content)` → `annotateTopLevelLines` → `marked.parser`
 * → `applySourceLineAttrs(container, tokens)` after the HTML is in the DOM.
 *
 * Granularity is one marker per top-level block, but each block carries
 * both `_line` and `_endLine` so the preview side can interpolate y ↔ line
 * fractionally inside long blocks (code fences, lists, tables). Without
 * the end marker, scrolling 30 lines through a code block would land on
 * the block's first line until the block scrolled out — visible as the
 * preview "freezing" relative to the editor.
 */
import type { Token } from 'marked';

// Marked's `Token` is a discriminated union — `interface extends` can't
// widen it without losing the narrowing, so we use an intersection.
export type AnnotatedToken = Token & { _line?: number; _endLine?: number };

/**
 * Stamp `_line` and `_endLine` on each top-level token using a running
 * newline counter. Marked tokens cover the entire source contiguously
 * (incl. blank-line `space` tokens), so summing newlines in `raw` gives
 * the next token's starting line — no need to search the source string.
 *
 * `_endLine` is the last source line the rendered block visually represents.
 * Tokens whose `raw` ends in `\n` (e.g. `space`) "own" up to but not
 * including the line where the next token begins; tokens that don't (e.g.
 * code, list, paragraph spanning multiple lines) own all newlines in
 * their raw.
 */
export function annotateTopLevelLines(tokens: Token[]): void {
  let line = 1;
  for (const token of tokens as AnnotatedToken[]) {
    const raw = token.raw ?? '';
    const newlines = countNewlines(raw);
    const endsWithNewline = raw.length > 0 && raw.charCodeAt(raw.length - 1) === 10;
    token._line = line;
    token._endLine = line + newlines - (endsWithNewline ? 1 : 0);
    if (token._endLine < line) token._endLine = line;
    line += newlines;
  }
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Walk the container's direct children in render order and stamp
 * `data-source-line="N"` and `data-source-line-end="M"` from the matching
 * top-level token. `space` tokens render to empty string so they're skipped
 * during pairing.
 *
 * Mismatches (e.g. a custom image renderer producing multiple top-level
 * nodes) only cost ±1 line of alignment drift — acceptable, since the
 * editor side also snaps to the nearest line block.
 */
export function applySourceLineAttrs(container: HTMLElement, tokens: Token[]): void {
  const annotated = tokens as AnnotatedToken[];
  let tokenIdx = 0;
  for (let i = 0; i < container.children.length; i++) {
    const child = container.children[i] as HTMLElement;
    // Skip auxiliary controls (e.g. the "Load all images" button) so
    // they don't consume a token slot and shift the anchor map.
    if (child.classList.contains('load-all-images-btn')) continue;
    while (tokenIdx < annotated.length && annotated[tokenIdx].type === 'space') {
      tokenIdx++;
    }
    if (tokenIdx >= annotated.length) break;
    const t = annotated[tokenIdx];
    if (t._line != null) {
      child.setAttribute('data-source-line', String(t._line));
      child.setAttribute('data-source-line-end', String(t._endLine ?? t._line));
    }
    tokenIdx++;
  }
}

/**
 * One rendered block as a `[startLine, endLine] ↔ [top, bottom]` interval.
 * Used by `topLineFor` / `offsetForLine` to interpolate fractional line
 * positions within multi-line blocks (so scrolling inside a 30-line code
 * fence still moves the other pane proportionally).
 */
export interface PreviewAnchor {
  startLine: number;
  endLine: number;
  /** offsetTop relative to `container`. */
  top: number;
  /** offsetTop + height. */
  bottom: number;
}

export function collectPreviewAnchors(container: HTMLElement): PreviewAnchor[] {
  const nodes = container.querySelectorAll<HTMLElement>('[data-source-line]');
  const anchors: PreviewAnchor[] = [];
  const containerTop = container.getBoundingClientRect().top;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const startLine = Number(el.getAttribute('data-source-line'));
    if (!Number.isFinite(startLine)) continue;
    const endAttr = el.getAttribute('data-source-line-end');
    const endLine = endAttr != null && Number.isFinite(Number(endAttr))
      ? Number(endAttr)
      : startLine;
    // Use rect math (not offsetTop) to handle nested transforms / margins
    // consistently. Read once per anchor.
    const rect = el.getBoundingClientRect();
    const top = rect.top - containerTop + container.scrollTop;
    const bottom = top + rect.height;
    anchors.push({ startLine, endLine, top, bottom });
  }
  return anchors;
}

/**
 * Map a y-coordinate (within the container) to a fractional source line.
 *
 * - Inside an anchor's `[top, bottom]`: linearly interpolate to a fractional
 *   line in `[startLine, endLine]`.
 * - In the gap between two anchors: interpolate from the previous anchor's
 *   `endLine` toward the next anchor's `startLine`. The gap is usually just
 *   margin, but interpolating keeps the mapping continuous so the other
 *   pane scrolls smoothly.
 * - Before the first anchor or after the last: clamp to the nearest edge.
 */
export function topLineFor(anchors: PreviewAnchor[], y: number): number {
  if (anchors.length === 0) return 1;
  // Binary search: largest anchor with top <= y.
  let lo = 0;
  let hi = anchors.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].top <= y) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const a = anchors[best];
  if (y <= a.top) return a.startLine;
  if (y < a.bottom) {
    const span = a.bottom - a.top;
    if (span <= 0) return a.startLine;
    const ratio = (y - a.top) / span;
    return a.startLine + ratio * (a.endLine - a.startLine);
  }
  // Past this anchor's bottom — interpolate the gap to the next, else clamp.
  const next = anchors[best + 1];
  if (next && y < next.top) {
    const span = next.top - a.bottom;
    if (span <= 0) return a.endLine;
    const ratio = (y - a.bottom) / span;
    return a.endLine + ratio * (next.startLine - a.endLine);
  }
  return a.endLine;
}

/**
 * Inverse of `topLineFor`: map a (possibly fractional) source line back to
 * a y-coordinate within the container.
 */
export function offsetForLine(anchors: PreviewAnchor[], line: number): number {
  if (anchors.length === 0) return 0;
  // Binary search: largest anchor with startLine <= line.
  let lo = 0;
  let hi = anchors.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].startLine <= line) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const a = anchors[best];
  if (line <= a.startLine) return a.top;
  if (line <= a.endLine) {
    const lineSpan = a.endLine - a.startLine;
    if (lineSpan <= 0) return a.top;
    const ratio = (line - a.startLine) / lineSpan;
    return a.top + ratio * (a.bottom - a.top);
  }
  // Past this anchor's endLine — interpolate gap to next, else clamp.
  const next = anchors[best + 1];
  if (next && line < next.startLine) {
    const lineSpan = next.startLine - a.endLine;
    if (lineSpan <= 0) return a.bottom;
    const ratio = (line - a.endLine) / lineSpan;
    return a.bottom + ratio * (next.top - a.bottom);
  }
  return a.bottom;
}
