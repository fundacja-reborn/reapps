/**
 * Widget renderers for Live Preview mode.
 *
 * `LinkWidget` replaces a `[text](url)` markdown link with a clickable anchor
 * that shows only the display text. URL safety mirrors the allowlist used by
 * MarkdownPreview's DOMPurify config — javascript:/data: schemes are blocked.
 *
 * `CodeBlockWidget` replaces a fenced code block (```lang ... ```) with a
 * statically syntax-highlighted <pre><code>. Highlighting uses the same CM6
 * language parsers we ship for the editor (zero external requests). Languages
 * are loaded lazily — until ready, the widget renders plaintext and triggers
 * a re-render via `onLanguageReady` once the chunk resolves.
 *
 * The shared highlight pipeline lives in `highlight-html.ts` so the editor
 * widget and the rendered Markdown preview produce visually identical output.
 */
import type { EditorView } from '@codemirror/view';
import { WidgetType } from '@codemirror/view';
import { matchLanguage, getLoadedLanguage } from './code-languages';
import {
  normalizeCodeText,
  renderHighlightedDom,
  sanitizeInfoClass,
  triggerLanguageLoad
} from './highlight-html';
import { CODE_COPY_ICON, copyCodeFromButton, type CodeCopyLabels } from './code-copy';

export { sanitizeInfoClass } from './highlight-html';
/** Backwards-compat alias for previous DOM helper name. */
export { renderHighlightedDom as renderHighlighted } from './highlight-html';

// `note:UUID` with an optional `#heading-slug`. Group 1 = UUID, group 2 = the
// anchor (without the `#`), undefined when the link targets the note as a whole.
const NOTE_URL_RE =
  /^note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#(.+))?$/i;

const ALLOWED_SCHEMES = /^(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):/i;

export function sanitizeLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (NOTE_URL_RE.test(trimmed)) return trimmed;
  if (ALLOWED_SCHEMES.test(trimmed)) return trimmed;
  if (/^[/.#]/.test(trimmed)) return trimmed; // relative / fragment
  return null;
}

export class LinkWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly url: string
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof LinkWidget && other.text === this.text && other.url === this.url;
  }

  toDOM(): HTMLElement {
    const safeUrl = sanitizeLinkUrl(this.url);

    // Internal note link (`note:UUID` or `note:UUID#heading-slug`): inert span,
    // navigation handled by NoteEditor's click handler. The optional anchor is
    // carried in its own data attribute so the click can scroll to the heading
    // after the target note renders.
    const noteMatch = safeUrl ? NOTE_URL_RE.exec(safeUrl) : null;
    if (noteMatch) {
      const span = document.createElement('span');
      span.classList.add('cm-lp-link', 'cm-note-link');
      span.dataset.noteLink = 'true';
      span.dataset.noteId = noteMatch[1];
      if (noteMatch[2]) span.dataset.noteAnchor = noteMatch[2];
      span.title = this.url;
      span.textContent = '📝 ' + this.text;
      return span;
    }

    // In-note heading anchor (`#slug` — a copied same-note heading link, or a
    // body anchor). Render a real anchor, but its click scrolls within the
    // editor (wired by `livePreviewAnchorScroll`) instead of opening a new tab.
    if (safeUrl && safeUrl.startsWith('#')) {
      const internal = document.createElement('a');
      internal.classList.add('cm-lp-link', 'cm-lp-anchor-link');
      internal.textContent = this.text;
      internal.href = safeUrl;
      internal.title = this.url;
      return internal;
    }

    const anchor = document.createElement('a');
    anchor.classList.add('cm-lp-link');
    anchor.title = this.url;
    if (safeUrl) {
      anchor.textContent = this.text;
      anchor.href = safeUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    } else {
      anchor.textContent = this.text;
      anchor.classList.add('cm-lp-link-blocked');
    }
    return anchor;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Triggered by widgets when an awaited language finally finishes loading,
 * so the editor can re-run `buildDecorations` and replace the plaintext
 * pre with a highlighted one. Wired by `NoteEditor.svelte` at mount time.
 */
let onLanguageReady: ((view: EditorView) => void) | null = null;
let activeView: EditorView | null = null;

export function registerCodeBlockView(
  view: EditorView,
  callback: (view: EditorView) => void
): () => void {
  activeView = view;
  onLanguageReady = callback;
  return () => {
    if (activeView === view) {
      activeView = null;
      onLanguageReady = null;
    }
  };
}

function ensureLanguageLoaded(info: string): void {
  void triggerLanguageLoad(info).then((loaded) => {
    if (loaded && activeView && onLanguageReady) onLanguageReady(activeView);
  });
}

export class CodeBlockWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly info: string | null,
    readonly labels: CodeCopyLabels
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CodeBlockWidget &&
      other.code === this.code &&
      other.info === this.info &&
      other.labels.copy === this.labels.copy &&
      other.labels.copied === this.labels.copied
    );
  }

  toDOM(): HTMLElement {
    // Outer (non-scrolling) wrapper anchors the absolutely-positioned copy
    // button so it stays pinned to the top-right while the code scrolls under
    // it. The inner `.cm-lp-codeblock-wrap` is the horizontal scroll container:
    // without it, the <pre>'s `white-space: pre` propagates a min-content width
    // up to `.cm-content`, expanding it past the viewport on mobile and forcing
    // sibling lines (paragraphs, headings) to overflow the screen. The wrap's
    // `overflow-x: auto` (set in theme.ts) creates a new BFC that contains the
    // intrinsic width of the code so only the code scrolls. The button must sit
    // outside that scroll container, otherwise it would scroll away / clip.
    const outer = document.createElement('div');
    outer.classList.add('cm-lp-codeblock-outer');

    const wrap = document.createElement('div');
    wrap.classList.add('cm-lp-codeblock-wrap');

    const pre = document.createElement('pre');
    pre.classList.add('cm-lp-codeblock');

    const codeEl = document.createElement('code');
    const safeClass = this.info ? sanitizeInfoClass(this.info) : null;
    if (safeClass) codeEl.classList.add(`lang-${safeClass}`);

    const lang = this.info ? getLoadedLanguage(this.info) : null;
    if (lang) {
      renderHighlightedDom(codeEl, this.code, lang);
    } else {
      // Terminate with a trailing newline like the highlighted path so the
      // last line stays selectable even before the language chunk loads.
      codeEl.textContent = normalizeCodeText(this.code);
      if (this.info && matchLanguage(this.info)) {
        ensureLanguageLoaded(this.info);
      }
    }

    pre.appendChild(codeEl);
    wrap.appendChild(pre);
    outer.appendChild(this.buildCopyButton());
    outer.appendChild(wrap);
    return outer;
  }

  /**
   * Copy-to-clipboard button pinned to the block's top-right. Labels are
   * injected via the constructor (decorations build them from i18n) so this
   * module stays free of store imports — same decoupling as `ImageWidget`. A
   * locale change rebuilds the widget because `eq()` compares the labels.
   * `mousedown` is prevented so clicking the button doesn't move the CM6 cursor
   * into the block (which would swap this widget for the raw editable lines).
   */
  private buildCopyButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-lp-code-copy';
    btn.title = this.labels.copy;
    btn.setAttribute('aria-label', this.labels.copy);
    btn.innerHTML = CODE_COPY_ICON;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void copyCodeFromButton(btn, this.code, this.labels);
    });
    return btn;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Replaces the `- [ ]` / `- [x]` prefix of a GFM task list item with an
 * interactive `<input type="checkbox">`. Click toggles the markdown source
 * marker `[ ] ↔ [x]` in one CM6 transaction (handled by
 * `livePreviewTaskCheckboxToggle` in decorations.ts). The widget itself is
 * stateless — `checked` is derived from the parsed `TaskMarker` on each
 * decoration build.
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof TaskCheckboxWidget && other.checked === this.checked;
  }

  toDOM(): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'cm-lp-task-checkbox';
    // Stop CM6 from interpreting the click as a selection change so the
    // change event reaches `livePreviewTaskCheckboxToggle` cleanly.
    input.addEventListener('mousedown', (e) => e.preventDefault());
    return input;
  }

  ignoreEvent(): boolean {
    // Let `change` events bubble to the dom event handler.
    return false;
  }
}
