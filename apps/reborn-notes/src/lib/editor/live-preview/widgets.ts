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
 */
import type { EditorView } from '@codemirror/view';
import { WidgetType } from '@codemirror/view';
import type { LanguageSupport } from '@codemirror/language';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { matchLanguage, getLoadedLanguage } from './code-languages';

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
 * Whitelist for the rendered `class="lang-X"` on the <code> element.
 * Restricts info string to a safe subset before it ever reaches the DOM.
 */
const INFO_CLASS_RE = /^[a-z0-9_+#-]{1,32}$/i;

export function sanitizeInfoClass(info: string): string | null {
  const trimmed = info.trim().toLowerCase();
  if (!trimmed) return null;
  return INFO_CLASS_RE.test(trimmed) ? trimmed : null;
}

/**
 * Renders syntax-highlighted text into `target`. Uses `@lezer/highlight`'s
 * stable `classHighlighter` (emits `tok-keyword`, `tok-string`, ...). Matching
 * CSS rules live in `theme.ts` so the rendered widget mirrors the editor's
 * raw-mode highlighting closely.
 */
export function renderHighlighted(
  target: HTMLElement,
  code: string,
  lang: LanguageSupport
): void {
  const tree = lang.language.parser.parse(code);
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      if (classes) {
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = text;
        target.appendChild(span);
      } else {
        target.appendChild(document.createTextNode(text));
      }
    },
    () => {
      target.appendChild(document.createTextNode('\n'));
    }
  );
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

const pendingLoads = new Set<string>();

function ensureLanguageLoaded(info: string): void {
  const desc = matchLanguage(info);
  if (!desc || desc.support || pendingLoads.has(desc.name)) return;
  pendingLoads.add(desc.name);
  desc
    .load()
    .then(() => {
      if (activeView && onLanguageReady) onLanguageReady(activeView);
    })
    .catch(() => {
      // Swallow — widget already rendered plaintext fallback. Allow retry next render.
      pendingLoads.delete(desc.name);
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
    const pre = document.createElement('pre');
    pre.classList.add('cm-lp-codeblock');

    const codeEl = document.createElement('code');
    const safeClass = this.info ? sanitizeInfoClass(this.info) : null;
    if (safeClass) codeEl.classList.add(`lang-${safeClass}`);

    const lang = this.info ? getLoadedLanguage(this.info) : null;
    if (lang) {
      renderHighlighted(codeEl, this.code, lang);
    } else {
      codeEl.textContent = this.code;
      if (this.info && matchLanguage(this.info)) {
        ensureLanguageLoaded(this.info);
      }
    }

    pre.appendChild(codeEl);
    return pre;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
