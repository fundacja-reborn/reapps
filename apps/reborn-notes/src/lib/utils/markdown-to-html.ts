/**
 * Shared marked renderer overrides for list / task-list rendering.
 *
 * Used by:
 *  - `MarkdownPreview.svelte` (interactive — checkbox click toggles source via
 *    `data-task-index`)
 *  - `exportNoteAsPdf` (static — same HTML; the data attribute and the
 *    missing `disabled` flag on the checkbox are harmless in non-interactive
 *    output, and reusing the same shape keeps the export visually in step
 *    with what the user sees while editing)
 *
 * State (`listDepth`, `taskCounter`) is captured per factory call so two
 * concurrent renders don't interleave; call `reset()` at the start of each
 * parse so `data-task-index` ordinals start at 0 and `data-d` depth attrs
 * match Live Preview's geometry.
 */
import type { RendererObject, Tokens } from 'marked';

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
