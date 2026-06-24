/**
 * Live Preview widget for the in-note table of contents.
 *
 * Renders the managed `<!-- toc -->` block as the SAME boxed `<nav>` + corner
 * toolbar (refresh / remove) the rendered `MarkdownPreview` shows, so the editor
 * and the preview look identical. Modelled on `CodeBlockWidget`: a block-level
 * `Decoration.replace` that swaps to raw markdown when the cursor enters its
 * range (click-to-edit), with a corner toolbar revealed on hover - the copy
 * button precedent. The widget is inert DOM; clicks on its buttons and entry
 * links are wired by `livePreviewTocActions` in `decorations.ts`.
 *
 * The inner title + list are rendered through marked + DOMPurify exactly like
 * the preview (one rendering definition keeps inline formatting in entry labels
 * - `` `code` ``, **bold** - pixel-identical between the two views). The sanitize
 * config MIRRORS MarkdownPreview.svelte; keep them in sync.
 */
import { WidgetType } from '@codemirror/view';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

/** i18n labels for the corner toolbar (cannot read Svelte stores inside a widget). */
export interface TocWidgetLabels {
  /** Refresh button, default state. */
  refresh: string;
  /** Refresh button when the TOC is out of date (drives the amber affordance). */
  stale: string;
  /** Remove button. */
  remove: string;
}

// Refresh + remove glyphs. Twins of the constants in MarkdownPreview.svelte
// (static, self-contained Lucide-style SVGs, never user input) so the editor
// widget and the rendered preview show the same icons - keep them in sync.
const TOC_REFRESH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
const TOC_REMOVE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

// Vanilla marked for the TOC's inner title + list - mirrors MarkdownPreview's
// dedicated `tocMd` (gfm + breaks, default list markup we style under
// `.cm-lp-toc`). No custom renderers: the block is plain `**title**` + links.
const tocMd = new Marked({ gfm: true, breaks: true });

// Mirrors MarkdownPreview.svelte's DOMPurify config. Entry labels are user
// content (heading text), so the rendered HTML MUST be sanitized; the URI
// allowlist passes `#fragment` anchors (and the inline SVG profile passes the
// toolbar glyphs) while blocking javascript:/data: schemes.
const ALLOWED_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|note):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i; // eslint-disable-line no-useless-escape

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    ALLOWED_URI_REGEXP: ALLOWED_URI
  });
}

/** Escape `"` so a label is safe inside a double-quoted HTML attribute. */
function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

/**
 * Block widget for a managed TOC. Constructed in `buildDecorations` from the
 * block's inner markdown + a freshly-computed `stale` flag; `eq()` compares both
 * (and the labels) so the widget re-renders when the list changes, drift
 * appears/clears, or the locale changes - and is reused otherwise.
 */
export class TocWidget extends WidgetType {
  constructor(
    readonly innerMarkdown: string,
    readonly stale: boolean,
    readonly labels: TocWidgetLabels
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof TocWidget &&
      other.innerMarkdown === this.innerMarkdown &&
      other.stale === this.stale &&
      other.labels.refresh === this.labels.refresh &&
      other.labels.stale === this.labels.stale &&
      other.labels.remove === this.labels.remove
    );
  }

  toDOM(): HTMLElement {
    const nav = document.createElement('nav');
    nav.className = 'cm-lp-toc';
    nav.setAttribute('data-note-toc', '');

    // Refresh button doubles as the "out of date" indicator: amber + the
    // `stale` label/title when drift is detected (class hook `is-stale`).
    const refreshLabel = escAttr(this.stale ? this.labels.stale : this.labels.refresh);
    const removeLabel = escAttr(this.labels.remove);
    const staleCls = this.stale ? ' is-stale' : '';
    const toolbar =
      '<span class="cm-lp-toc-actions">' +
      `<button type="button" class="cm-lp-toc-btn cm-lp-toc-refresh${staleCls}" aria-label="${refreshLabel}" title="${refreshLabel}">${TOC_REFRESH_ICON}</button>` +
      `<button type="button" class="cm-lp-toc-btn cm-lp-toc-remove" aria-label="${removeLabel}" title="${removeLabel}">${TOC_REMOVE_ICON}</button>` +
      '</span>';

    // Static toolbar + sanitized content. tocMd.parse is synchronous (no async
    // options); the `as string` mirrors MarkdownPreview's call site.
    nav.innerHTML = toolbar + sanitize(tocMd.parse(this.innerMarkdown) as string);
    return nav;
  }

  ignoreEvent(): boolean {
    // Let button / entry-link clicks reach `livePreviewTocActions`.
    return false;
  }
}
