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
  renderHighlightedDom,
  sanitizeInfoClass,
  triggerLanguageLoad
} from './highlight-html';

export { sanitizeInfoClass } from './highlight-html';
/** Backwards-compat alias for previous DOM helper name. */
export { renderHighlightedDom as renderHighlighted } from './highlight-html';

const NOTE_URL_RE =
  /^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const isNote = safeUrl !== null && NOTE_URL_RE.test(safeUrl);

    if (isNote && safeUrl) {
      // Note links rendered as inert span — navigation handled by editor click handler.
      const span = document.createElement('span');
      span.classList.add('cm-lp-link', 'cm-note-link');
      span.dataset.noteLink = 'true';
      span.dataset.noteId = safeUrl.replace(/^note:/i, '');
      span.title = this.url;
      span.textContent = '📝 ' + this.text;
      return span;
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
    readonly info: string | null
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CodeBlockWidget &&
      other.code === this.code &&
      other.info === this.info
    );
  }

  toDOM(): HTMLElement {
    // Outer wrapper is the horizontal scroll container.
    // Without this, the <pre>'s `white-space: pre` propagates a min-content
    // width up to `.cm-content`, expanding it past the viewport on mobile and
    // forcing sibling lines (paragraphs, headings) to overflow the screen.
    // The wrapper's `overflow-x: auto` (set in theme.ts) creates a new BFC
    // that contains the intrinsic width of the code so only the code scrolls.
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
      codeEl.textContent = this.code;
      if (this.info && matchLanguage(this.info)) {
        ensureLanguageLoaded(this.info);
      }
    }

    pre.appendChild(codeEl);
    wrap.appendChild(pre);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
