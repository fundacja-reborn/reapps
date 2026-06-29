/**
 * Minimal inline-markdown renderer for Live Preview table cells.
 *
 * GFM table cells can't host block content, so a cell only ever needs the
 * handful of inline constructs: bold, italic, strikethrough, inline code and
 * links (plus `\n` soft breaks from Shift+Enter). The full markdown pipeline
 * (`@lezer/markdown` / `marked` + DOMPurify) is overkill and can't run on the
 * tiny string slices a single cell holds, so we hand-roll a tiny scanner.
 *
 * Two layers:
 *  - `parseInlineCell(text)` → a flat-ish AST (`InlineNode[]`). PURE and
 *    DOM-free, so it is the unit-tested surface (vitest runs in `node`).
 *  - `buildInlineFragment(text)` → a `DocumentFragment` built from that AST.
 *    Browser-only (touches `document`); verified by manual smoke, mirroring how
 *    the other Live Preview widgets keep their `toDOM` out of unit tests.
 *
 * Security: every leaf string reaches the DOM through `createTextNode` /
 * `textContent` (never `innerHTML`), and links are delegated to the existing,
 * allowlist-guarded `LinkWidget`. A cell containing `<script>` renders as the
 * literal text `<script>`. No new sink, no DOMPurify needed.
 */
import { LinkWidget } from './widgets';

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'br' }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'link'; text: string; url: string };

/** Unicode letter or number — used for emphasis flanking rules. */
const WORD = /[\p{L}\p{N}]/u;
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

interface DelimMatch {
  /** Raw text between the delimiters (parsed recursively by the caller). */
  content: string;
  /** Total characters consumed from `open`, including both delimiters. */
  length: number;
}

/**
 * Try to match an emphasis-style span (`**`, `__`, `*`, `_`, `~~`) starting at
 * `open`. Returns the inner content and consumed length, or `null` if there is
 * no well-formed span here.
 *
 * Implements a pragmatic subset of CommonMark's delimiter rules — enough to be
 * intuitive without a full delimiter-stack parser:
 *  - the opener must be immediately followed by non-space content;
 *  - the closer must be immediately preceded by non-space;
 *  - `_`/`__` need a word boundary on the outside, so `snake_case` and
 *    `a_b_c` stay literal while `*a*` intraword still works (matching the GFM
 *    intuition most users carry);
 *  - a candidate closer that is part of a longer delimiter run is skipped, so
 *    `*` does not close on the first `*` of a `**`.
 */
function matchDelimiter(text: string, open: number, delim: string): DelimMatch | null {
  const dl = delim.length;
  if (text.slice(open, open + dl) !== delim) return null;

  const charBeforeOpen = text[open - 1];
  const charAfterOpen = text[open + dl];

  // Opener needs content right after it (no `** bold**`, no empty `****`).
  if (charAfterOpen === undefined || /\s/.test(charAfterOpen)) return null;

  const underscore = delim[0] === '_';
  if (underscore && isWordChar(charBeforeOpen)) return null;

  let search = open + dl;
  while (search < text.length) {
    const idx = text.indexOf(delim, search);
    if (idx === -1) return null;

    // Empty content (`****`) — keep looking for a later closer.
    if (idx === open + dl) {
      search = idx + dl;
      continue;
    }

    const charBeforeClose = text[idx - 1];
    const charAfterClose = text[idx + dl];

    // Closer must not have a space right before it (`bold **` is not a closer).
    if (charBeforeClose !== undefined && /\s/.test(charBeforeClose)) {
      search = idx + dl;
      continue;
    }
    // Single-char delimiters: skip a candidate that is really part of a longer
    // run (so `*` in `**x**` is handled by the `**` matcher, not this one).
    if ((delim === '*' || delim === '_') && (charBeforeClose === delim || charAfterClose === delim)) {
      search = idx + 1;
      continue;
    }
    // Underscore emphasis also needs a word boundary on the right.
    if (underscore && isWordChar(charAfterClose)) {
      search = idx + 1;
      continue;
    }

    return { content: text.slice(open + dl, idx), length: idx + dl - open };
  }
  return null;
}

/** Match an inline code span (`` `code` ``, ``` ``code with ` inside`` ```). */
function matchCode(text: string, pos: number): DelimMatch | null {
  if (text[pos] !== '`') return null;
  let run = 0;
  while (text[pos + run] === '`') run += 1;
  const fence = '`'.repeat(run);

  let search = pos + run;
  while (search <= text.length - run) {
    const idx = text.indexOf(fence, search);
    if (idx === -1) return null;
    // Require an exact-length backtick run for the closer.
    if (text[idx - 1] === '`' || text[idx + run] === '`') {
      search = idx + 1;
      continue;
    }
    let content = text.slice(pos + run, idx);
    // CommonMark: strip one leading and trailing space if the span isn't blank.
    if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
      content = content.slice(1, -1);
    }
    return { content, length: idx + run - pos };
  }
  return null;
}

interface LinkMatch {
  text: string;
  url: string;
  length: number;
}

/** Match a `[text](url)` link. Titles (`[t](url "x")`) are dropped. */
function matchLink(text: string, pos: number): LinkMatch | null {
  if (text[pos] !== '[') return null;
  const closeBracket = text.indexOf(']', pos + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null;
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;

  const linkText = text.slice(pos + 1, closeBracket);
  let dest = text.slice(closeBracket + 2, closeParen).trim();
  const spaceIdx = dest.search(/\s/);
  if (spaceIdx !== -1) dest = dest.slice(0, spaceIdx); // drop optional title
  if (!dest) return null;

  return { text: linkText, url: dest, length: closeParen + 1 - pos };
}

/** Parse a single line (no `\n`) into inline nodes. */
function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      nodes.push({ type: 'text', value: buf });
      buf = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      const code = matchCode(text, i);
      if (code) {
        flush();
        nodes.push({ type: 'code', value: code.content });
        i += code.length;
        continue;
      }
    } else if (ch === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        nodes.push({ type: 'link', text: link.text, url: link.url });
        i += link.length;
        continue;
      }
    } else if (ch === '*') {
      const strong = matchDelimiter(text, i, '**');
      if (strong) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(strong.content) });
        i += strong.length;
        continue;
      }
      const em = matchDelimiter(text, i, '*');
      if (em) {
        flush();
        nodes.push({ type: 'em', children: parseInline(em.content) });
        i += em.length;
        continue;
      }
    } else if (ch === '_') {
      const strong = matchDelimiter(text, i, '__');
      if (strong) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(strong.content) });
        i += strong.length;
        continue;
      }
      const em = matchDelimiter(text, i, '_');
      if (em) {
        flush();
        nodes.push({ type: 'em', children: parseInline(em.content) });
        i += em.length;
        continue;
      }
    } else if (ch === '~') {
      const strike = matchDelimiter(text, i, '~~');
      if (strike) {
        flush();
        nodes.push({ type: 'strike', children: parseInline(strike.content) });
        i += strike.length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return nodes;
}

/**
 * Parse a full cell value (decoded form: literal `\n` for Shift+Enter breaks)
 * into inline nodes, inserting a `br` node between lines.
 */
export function parseInlineCell(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out.push({ type: 'br' });
    out.push(...parseInline(lines[i]));
  }
  return out;
}

/**
 * True if the cell contains any inline formatting (i.e. its rendered form
 * differs from its raw source). Plain text — even multi-line — returns false,
 * which lets the widget skip the rendered↔raw swap and keep native caret
 * placement when such a cell is focused.
 */
export function cellHasFormatting(text: string): boolean {
  return parseInlineCell(text).some((n) => n.type !== 'text' && n.type !== 'br');
}

function appendChildren(el: HTMLElement, children: InlineNode[]): void {
  for (const child of children) el.appendChild(nodeToDom(child));
}

function nodeToDom(node: InlineNode): Node {
  switch (node.type) {
    case 'text':
      return document.createTextNode(node.value);
    case 'br':
      return document.createElement('br');
    case 'code': {
      const el = document.createElement('code');
      el.className = 'cm-lp-code';
      el.textContent = node.value;
      return el;
    }
    case 'strong': {
      const el = document.createElement('strong');
      el.className = 'cm-lp-strong';
      appendChildren(el, node.children);
      return el;
    }
    case 'em': {
      const el = document.createElement('em');
      el.className = 'cm-lp-em';
      appendChildren(el, node.children);
      return el;
    }
    case 'strike': {
      const el = document.createElement('del');
      el.className = 'cm-lp-strike';
      appendChildren(el, node.children);
      return el;
    }
    case 'link': {
      // Reuse the Live Preview link renderer: same URL allowlist, same
      // note-link / blocked-link handling as links elsewhere in the editor.
      const el = new LinkWidget(node.text, node.url).toDOM();
      // Keep a left-click on the link from focusing the cell — focusing would
      // swap the rendered view for raw source before the click resolves, so the
      // link would never open. (Note links already do this inside LinkWidget;
      // we extend it to every link type.) The cell stays editable: click its
      // padding or any non-link text, or Tab in.
      el.addEventListener('mousedown', (e) => {
        if (e.button === 0) e.preventDefault();
      });
      return el;
    }
  }
}

/** Build a DocumentFragment rendering `text` with inline formatting applied. */
export function buildInlineFragment(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const node of parseInlineCell(text)) frag.appendChild(nodeToDom(node));
  return frag;
}
