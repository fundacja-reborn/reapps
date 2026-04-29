/**
 * Shared syntax-highlight helpers used by both Live Preview's `CodeBlockWidget`
 * (DOM output) and `MarkdownPreview`'s rendered HTML (string output). Keeping a
 * single pipeline here means both views render fenced code identically and
 * share the same async language-loading + sanitisation rules.
 *
 * Output contract:
 *  - text always escaped (`textContent` / HTML-escape) — never `innerHTML`
 *  - token classes come from `@lezer/highlight#classHighlighter` (`tok-keyword`
 *    etc.) — library-controlled, never user input
 *  - info string sanitised via `sanitizeInfoClass` before reaching `class=`
 */
import type { LanguageSupport } from '@codemirror/language';
import { highlightCode, classHighlighter } from '@lezer/highlight';
import { matchLanguage, getLoadedLanguage } from './code-languages';

/**
 * Whitelist for the rendered `class="lang-X"` on the `<code>` element.
 * Restricts info string to a safe subset before it ever reaches the DOM.
 */
const INFO_CLASS_RE = /^[a-z0-9_+#-]{1,32}$/i;

export function sanitizeInfoClass(info: string): string | null {
  const trimmed = info.trim().toLowerCase();
  if (!trimmed) return null;
  return INFO_CLASS_RE.test(trimmed) ? trimmed : null;
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(s: string): string {
  return s.replace(HTML_ESCAPE_RE, (c) => HTML_ESCAPES[c]);
}

/**
 * Render syntax-highlighted code into `target` (DOM). Used by `CodeBlockWidget`.
 */
export function renderHighlightedDom(
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
 * Render syntax-highlighted code as an HTML string. Used by `MarkdownPreview`
 * via `marked.Renderer.code`. Output is composed of escaped text segments —
 * the only HTML produced here are `<span class="tok-...">` wrappers using
 * library-controlled class names. Safe to feed to DOMPurify.
 */
function renderHighlightedHtml(code: string, lang: LanguageSupport): string {
  const tree = lang.language.parser.parse(code);
  let out = '';
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      if (classes) {
        out += `<span class="${classes}">${escapeHtml(text)}</span>`;
      } else {
        out += escapeHtml(text);
      }
    },
    () => {
      out += '\n';
    }
  );
  return out;
}

/**
 * Public entry point for rendering a fenced code block as `<pre><code>` HTML.
 * Resolves the language synchronously from `getLoadedLanguage`; if the chunk
 * has not loaded yet, callers should kick off `triggerLanguageLoad(info)` and
 * re-render once the returned promise resolves.
 *
 * Output is always safe HTML — text is escaped, only library class names appear
 * inside `<span>` wrappers, and the language class is sanitised.
 */
export function highlightCodeToHtml(code: string, info: string): string {
  const safeClass = info ? sanitizeInfoClass(info) : null;
  const codeAttrs = safeClass ? ` class="lang-${safeClass}"` : '';
  const lang = info ? getLoadedLanguage(info) : null;
  const body = lang ? renderHighlightedHtml(code, lang) : escapeHtml(code);
  return `<pre class="cm-lp-codeblock"><code${codeAttrs}>${body}</code></pre>`;
}

/**
 * Kick off the async load for an info string's language. Callers can `await`
 * this to be notified when highlighting becomes available; safe to call
 * multiple times — repeat calls are deduplicated internally.
 *
 * Resolves to `true` if a language chunk was actually loaded by this call,
 * `false` otherwise (already loaded / unknown info / load failure).
 */
const pendingLoads = new Map<string, Promise<boolean>>();

export function triggerLanguageLoad(info: string): Promise<boolean> {
  const desc = matchLanguage(info);
  if (!desc) return Promise.resolve(false);
  if (desc.support) return Promise.resolve(false);
  const existing = pendingLoads.get(desc.name);
  if (existing) return existing;

  const p = desc
    .load()
    .then(() => true)
    .catch(() => {
      pendingLoads.delete(desc.name);
      return false;
    });
  pendingLoads.set(desc.name, p);
  return p;
}
