/**
 * Shared marked renderer overrides for list / task-list / image rendering.
 *
 * Used by:
 *  - `MarkdownPreview.svelte` (interactive — checkbox click toggles source via
 *    `data-task-index`)
 *  - `exportNoteAsPdf` (static — same HTML; the data attribute and the
 *    missing `disabled` flag on the checkbox are harmless in non-interactive
 *    output, and reusing the same shape keeps the export visually in step
 *    with what the user sees while editing)
 *
 * State (`listDepth`, `taskCounter`, the image renderer's `askPlaceholderCount`)
 * is captured per factory call so two concurrent renders don't interleave; call
 * `reset()` at the start of each parse so `data-task-index` ordinals start at 0
 * and `data-d` depth attrs match Live Preview's geometry.
 */
import type { RendererObject, Tokens } from 'marked';
import type { ImageLoadMode } from '@reborn/storage';

/** Visual cap mirroring MAX_LIST_DEPTH in editor/live-preview/decorations.ts. */
export const PREVIEW_MAX_LIST_DEPTH = 12;

export function createMarkdownListRenderers(): {
  renderer: RendererObject;
  reset: () => void;
} {
  let listDepth = 0;
  let taskCounter = 0;

  const renderer: RendererObject = {};

  // Stateful depth-aware list renderer. `this` is bound to the renderer
  // instance by marked's use({renderer}) wrapper, so we delegate item
  // rendering to this.listitem (overridden below) — items containing nested
  // lists will recurse back through this same override.
  renderer.list = function listOverride(this: unknown, token: Tokens.List) {
    listDepth++;
    const depth = Math.min(listDepth, PREVIEW_MAX_LIST_DEPTH);
    const self = this as { listitem: (i: Tokens.ListItem) => string };
    let body = '';
    for (const item of token.items) {
      body += self.listitem(item);
    }
    listDepth--;
    const tag = token.ordered ? 'ol' : 'ul';
    const startAttr =
      token.ordered && token.start !== 1 && token.start !== ''
        ? ` start="${token.start}"`
        : '';
    return `<${tag}${startAttr} data-d="${depth}">\n${body}</${tag}>\n`;
  };

  // GFM task list item — marked sets `task: true` on the token and prepends
  // a `checkbox` token to `tokens`. The default renderer wraps each <li>
  // without a class; we add `task-list-item` (+ `task-list-item-checked` for
  // `[x]`) so CSS can drop the bullet and apply strikethrough.
  // `data-task-index` is the zero-based ordinal of the task in render order
  // — Preview uses it to map a checkbox click back to the matching `[ ]`/`[x]`
  // in the markdown source; in static PDF output it's just an inert attr.
  renderer.listitem = function listitemOverride(
    this: unknown,
    token: Tokens.ListItem
  ) {
    const self = this as {
      parser: {
        parse: (t: Tokens.ListItem['tokens'], loose?: boolean) => string;
      };
    };
    if (!token.task) {
      const inner = self.parser.parse(token.tokens, !!token.loose);
      return `<li>${inner}</li>\n`;
    }
    // Reserve this item's index *before* recursing into children. Inner
    // parsing runs nested list items through this same override, and they'd
    // otherwise grab lower indices than the parent — making the parent's
    // `data-task-index` point past its own checkbox in the markdown source
    // (where `toggleTaskAt` walks `[ ]`/`[x]` markers top-to-bottom). Pre-
    // incrementing aligns render order with source order: parent first, then
    // descendants.
    const idx = taskCounter++;
    // Split the parent's own inline content (checkbox + text + inline
    // formatting) from any nested list tokens. Inline gets wrapped in a span
    // so the checked-state strikethrough scopes to the parent's own line
    // only — `text-decoration: line-through` propagates through inline
    // descendants of a line box, and `text-decoration: none` on a child
    // block does NOT cancel the parent's drawn line (a documented CSS
    // quirk; colour/opacity reset would still leave the strike visible on
    // children). Anchoring the decoration to a sibling-of-list wrapper
    // contains the line.
    const inlineTokens: Tokens.ListItem['tokens'] = [];
    const nestedTokens: Tokens.ListItem['tokens'] = [];
    for (const t of token.tokens) {
      if (t.type === 'list') nestedTokens.push(t as never);
      else inlineTokens.push(t as never);
    }
    const inlineHtml = self.parser.parse(inlineTokens, !!token.loose);
    const nestedHtml = nestedTokens.length
      ? self.parser.parse(nestedTokens, !!token.loose)
      : '';
    const cls = token.checked
      ? 'task-list-item task-list-item-checked'
      : 'task-list-item';
    return `<li class="${cls}" data-task-index="${idx}"><span class="task-list-item-content">${inlineHtml}</span>${nestedHtml}</li>\n`;
  };

  // Drop `disabled` from the GFM checkbox so Preview can route clicks; tag
  // with a class so the click handler can spot it without walking up to the
  // <li>. In PDF output the missing `disabled` is moot (no interaction).
  renderer.checkbox = function checkboxOverride({ checked }: Tokens.Checkbox) {
    return `<input type="checkbox" class="task-list-item-checkbox"${checked ? ' checked' : ''}> `;
  };

  return {
    renderer,
    reset: () => {
      listDepth = 0;
      taskCounter = 0;
    }
  };
}

const IMAGE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
const BLOCKED_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

/**
 * Image renderer for Preview. Behaviour by `ImageLoadMode`:
 *  - `always` — emit a plain lazy `<img>`.
 *  - `ask`    — emit a click-to-load placeholder *with* a Load button.
 *  - `never`  — emit the placeholder *without* a Load button.
 * `data:` URIs are always blocked (base64 isn't supported) regardless of mode.
 *
 * `getAskPlaceholderCount()` returns how many ask-mode Load buttons the last
 * parse emitted — the single source of truth for whether the "Load all images"
 * banner should show. The count is structural (the renderer bumps it only when
 * it actually runs the ask-mode branch), so unlike scanning the output HTML for
 * the `.image-placeholder-load` class it cannot be tripped by a note whose own
 * text happens to contain that class name or `![](…)` syntax inside a code span
 * — marked never calls this renderer for image syntax inside inline code or
 * fenced blocks. (That false positive is exactly what the prior source-regex
 * and HTML-substring gates suffered from; see markdown-to-html.spec.ts.)
 *
 * `translate(key)` resolves an i18n key at render time — the caller wraps its
 * reactive `$t` so placeholder labels follow locale changes. Call `setMode()`
 * and `reset()` before each parse, then read `getAskPlaceholderCount()` after.
 */
export function createMarkdownImageRenderer(translate: (key: string) => string): {
  renderImage: NonNullable<RendererObject['image']>;
  setMode: (mode: ImageLoadMode) => void;
  reset: () => void;
  getAskPlaceholderCount: () => number;
} {
  let mode: ImageLoadMode = 'ask';
  let askPlaceholderCount = 0;

  const renderImage = ({ href, title, text }: Tokens.Image): string => {
    const isDataUri = href.startsWith('data:');
    const escapedHref = href.replace(/"/g, '&quot;');
    const escapedAlt = (text || '').replace(/"/g, '&quot;');
    const escapedTitle = (title || '').replace(/"/g, '&quot;');

    if (isDataUri) {
      return `<div class="image-placeholder image-placeholder--blocked">
      <div class="image-placeholder-icon">${BLOCKED_ICON_SVG}</div>
      <div class="image-placeholder-url">${translate('editor.image_base64_blocked')}</div>
    </div>`;
    }

    if (mode === 'always') {
      return `<img src="${escapedHref}" alt="${escapedAlt}" title="${escapedTitle}" loading="lazy" />`;
    }

    const showLoadBtn = mode === 'ask';
    if (showLoadBtn) askPlaceholderCount++;
    return `<div class="image-placeholder" data-src="${escapedHref}" data-alt="${escapedAlt}" data-title="${escapedTitle}">
      <div class="image-placeholder-icon">${IMAGE_ICON_SVG}</div>
      <div class="image-placeholder-url">${escapedHref}</div>
      ${showLoadBtn ? `<button class="image-placeholder-load" type="button">${translate('editor.image_load')}</button>` : ''}
    </div>`;
  };

  return {
    renderImage,
    setMode: (m: ImageLoadMode) => {
      mode = m;
    },
    reset: () => {
      askPlaceholderCount = 0;
    },
    getAskPlaceholderCount: () => askPlaceholderCount
  };
}
