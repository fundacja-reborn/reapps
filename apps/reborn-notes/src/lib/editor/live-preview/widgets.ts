/**
 * Widget renderers for Live Preview mode.
 *
 * `LinkWidget` replaces a `[text](url)` markdown link with a clickable anchor
 * that shows only the display text. URL safety mirrors the allowlist used by
 * MarkdownPreview's DOMPurify config — javascript:/data: schemes are blocked.
 */
import { WidgetType } from '@codemirror/view';

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
