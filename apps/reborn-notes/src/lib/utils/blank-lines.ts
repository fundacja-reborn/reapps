/**
 * Extra blank lines between blocks, kept in the rendered note (issue #549).
 *
 * Markdown collapses any run of blank lines into one block break, so three
 * empty lines typed to set two groups apart vanish in Preview, in the PDF and
 * in a shared note - while the editor keeps showing them. With the "Keep extra
 * blank lines" setting on (the default) the first blank line stays the normal
 * block break and every further one renders as one empty line.
 *
 * Works on marked's token tree, never on the source: the Markdown itself, the
 * source-line map of the preview and the task / heading ordinals stay untouched.
 *
 *  - {@link markExtraBlankLines} stamps the count on the tokens (run it after
 *    `lexer()`, before `parser()`),
 *  - the shared renderer overrides in `markdown-to-html.ts` turn the stamps
 *    into {@link blankLinesHtml}.
 *
 * Where the blank lines live in the token tree (marked 18, checked in
 * blank-lines.spec.ts):
 *  - between two blocks: a `space` token whose `raw` holds one newline per
 *    blank line plus the one ending the previous block,
 *  - after a list item: in the item's own `raw` (the `space` token marked
 *    leaves at the end of `item.tokens` is one newline short, so it is not
 *    used).
 */
import type { Token, Tokens } from 'marked';

/** A `space` token that renders `_blankLines` empty lines. */
export type BlankLineSpace = Tokens.Space & { _blankLines?: number };

/** A list item followed by `_blankLinesAfter` empty lines inside its list. */
export type BlankLineListItem = Tokens.ListItem & { _blankLinesAfter?: number };

const NEWLINE = 10;

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === NEWLINE) n++;
  return n;
}

/** Newlines in the whitespace that ends `raw` (0 when it ends in content). */
function trailingNewlines(raw: string): number {
  return countNewlines(raw.slice(raw.trimEnd().length));
}

/**
 * Blank lines beyond the first, given the newlines between the end of one
 * block's content and the start of the next: one newline ends the line, one
 * makes the block break, the rest are extra.
 */
function extraFromNewlines(newlines: number): number {
  return Math.max(0, newlines - 2);
}

/**
 * Stamp the extra blank lines on a list of sibling tokens, recursing into
 * block quotes and list items. Mutates the tokens; call it on a fresh
 * `lexer()` result.
 *
 * Only gaps BETWEEN two rendered blocks count: blank lines before the first
 * block or after the last one (start / end of the note, of a quote, of a list
 * item's content) add nothing. A link reference definition renders nothing, so
 * the gaps around it are left alone as well.
 */
export function markExtraBlankLines(tokens: Token[]): void {
  let hasPrev = false;
  let newlines = 0;
  let lastSpace: BlankLineSpace | null = null;

  for (const token of tokens) {
    if (token.type === 'space') {
      newlines += countNewlines(token.raw);
      lastSpace = token as BlankLineSpace;
      continue;
    }
    if (token.type === 'def') {
      hasPrev = false;
      lastSpace = null;
      continue;
    }
    if (hasPrev && lastSpace) {
      const extra = extraFromNewlines(newlines);
      if (extra > 0) lastSpace._blankLines = extra;
    }
    hasPrev = true;
    lastSpace = null;
    newlines = trailingNewlines(token.raw);

    if (token.type === 'blockquote') {
      markExtraBlankLines((token as Tokens.Blockquote).tokens);
    } else if (token.type === 'list') {
      for (const item of (token as Tokens.List).items as BlankLineListItem[]) {
        markExtraBlankLines(item.tokens);
        // The last item's raw is trimmed, so this is 0 there: blank lines
        // after a list belong to the gap that follows the list itself.
        const after = extraFromNewlines(trailingNewlines(item.raw));
        if (after > 0) item._blankLinesAfter = after;
      }
    }
  }
}

/** Empty lines a token was stamped with (0 for anything unstamped). */
export function extraBlankLines(token: Token): number {
  return token.type === 'space' ? ((token as BlankLineSpace)._blankLines ?? 0) : 0;
}

/**
 * The rendered empty lines: one `<br>` per line in a block of its own, so each
 * takes exactly one line of the surrounding text size and line height - in the
 * preview, in the PDF, with any note text size - without inline styles (CSP)
 * or per-count CSS. Hidden from assistive tech: it is spacing, not content.
 */
export function blankLinesHtml(count: number): string {
  if (count <= 0) return '';
  return `<div class="md-blank-lines" aria-hidden="true">${'<br>'.repeat(count)}</div>\n`;
}
