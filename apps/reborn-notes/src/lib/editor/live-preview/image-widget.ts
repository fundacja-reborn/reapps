/**
 * Live Preview widget for inline images (`![alt](url)`).
 *
 * Three render branches selected by the user's `imageLoadMode` preference:
 *   - `'always'` → real `<img loading="lazy">` (after `sanitizeImageSrc`).
 *   - `'ask'`    → click-to-load placeholder with URL + Load button.
 *   - `'never'`  → placeholder with URL only, no button.
 *
 * `data:` URIs always render the blocked-warning placeholder regardless of
 * mode, mirroring `MarkdownPreview.svelte`'s renderer.image and the policy
 * documented in `docs/development/guidelines/40-mermaid-image-preview.md`.
 *
 * Visual parity with the regular Preview is intentional: when the cursor
 * leaves the image's markdown range, the editor and the rendered preview
 * show the same placeholder/image. When the cursor is INSIDE the range,
 * `decorations.ts` skips this widget and the user sees raw markdown
 * (`![alt](url)`) editable in place — the standard Live Preview pattern.
 */
import { WidgetType, type EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { ImageLoadMode } from '@reborn/storage';
import { rebuildLivePreview } from './decorations';

const HTTP_LIKE = /^https?:\/\//i;
const RELATIVE = /^[/.#]/;

/**
 * Allowlist for `<img src>`. Stricter than `sanitizeLinkUrl`: no `mailto:`,
 * `tel:`, `note:` (these are not loadable as images), and `data:` is blocked
 * unconditionally — base64 inline images are out of scope per project
 * security policy.
 */
export function sanitizeImageSrc(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (HTTP_LIKE.test(trimmed)) return trimmed;
  if (RELATIVE.test(trimmed)) return trimmed;
  return null;
}

export function isDataImageUri(url: string): boolean {
  return /^data:/i.test(url.trim());
}

export type ImageWidgetLabels = {
  /** Button text in 'ask' mode. */
  load: string;
  /** Inline notice for blocked data: URIs. */
  base64Blocked: string;
};

// ── Per-click image loading via CM6 state (no DOM mutation) ──────────

export const loadImageEffect = StateEffect.define<string>();

const EMPTY_SET: ReadonlySet<string> = new Set();

export const loadedImagesField = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update(value, tr) {
    let next: Set<string> | null = null;
    for (const e of tr.effects) {
      if (e.is(loadImageEffect) && !value.has(e.value)) {
        if (!next) next = new Set(value);
        next.add(e.value);
      }
    }
    return next ?? value;
  }
});

export function getLoadedImages(
  state: { field: <T>(f: StateField<T>, required?: boolean) => T | undefined }
): ReadonlySet<string> {
  return (state.field(loadedImagesField, false) as ReadonlySet<string> | undefined) ?? EMPTY_SET;
}

// ── SVG icon path for the image placeholder (lucide "image" icon) ────

const IMAGE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cm-lp-img-placeholder-icon-svg"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;

const BLOCKED_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cm-lp-img-placeholder-icon-svg"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

// ── Widget ────────────────────────────────────────────────────────────

export class ImageWidget extends WidgetType {
  constructor(
    readonly href: string,
    readonly alt: string,
    readonly title: string,
    readonly loadMode: ImageLoadMode,
    readonly labels: ImageWidgetLabels
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.href === this.href &&
      other.alt === this.alt &&
      other.title === this.title &&
      other.loadMode === this.loadMode &&
      other.labels.load === this.labels.load &&
      other.labels.base64Blocked === this.labels.base64Blocked
    );
  }

  toDOM(view: EditorView): HTMLElement {
    if (isDataImageUri(this.href)) {
      const blocked = buildBlockedPlaceholder(this.labels.base64Blocked);
      attachEditOnClick(blocked, view);
      return blocked;
    }

    const safeSrc = sanitizeImageSrc(this.href);
    if (!safeSrc) {
      const ph = buildPlaceholder(this.href, this.alt, this.title, false, this.labels.load);
      attachEditOnClick(ph, view);
      return ph;
    }

    if (this.loadMode === 'always') {
      const img = buildImage(safeSrc, this.alt, this.title);
      attachEditOnClick(img, view);
      return img;
    }

    const placeholder = buildPlaceholder(
      safeSrc,
      this.alt,
      this.title,
      this.loadMode === 'ask',
      this.labels.load
    );

    if (this.loadMode === 'ask') {
      const btn = placeholder.querySelector('.cm-lp-img-placeholder-load') as HTMLButtonElement | null;
      if (btn) {
        attachLoadHandler(btn, safeSrc, view);
      }
    }
    attachEditOnClick(placeholder, view);

    return placeholder;
  }

  /**
   * Treat the widget as opaque to CM6 — `true` for every event.
   *
   * CM6's default mousedown handler uses `posAtCoords` to set the caret,
   * which for an `<img>` widget lands the cursor at the widget boundary
   * (just before or just after the markdown range). That leaves the
   * widget rendered and prevents in-place editing.
   *
   * Instead, our own `click` listeners (`attachLoadHandler`,
   * `attachEditOnClick`) dispatch the right state change explicitly:
   * Load → `loadImageEffect`, anywhere else on the widget → selection
   * inside the markdown range so Live Preview hides the widget.
   */
  ignoreEvent(): boolean {
    return true;
  }
}

function buildImage(src: string, alt: string, title: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  if (title) img.title = title;
  img.loading = 'lazy';
  img.classList.add('cm-lp-img');
  return img;
}

function buildPlaceholder(
  href: string,
  alt: string,
  title: string,
  showLoadBtn: boolean,
  loadLabel: string
): HTMLElement {
  const wrap = document.createElement('span');
  wrap.classList.add('cm-lp-img-placeholder');
  if (alt) wrap.dataset.alt = alt;
  if (title) wrap.dataset.title = title;
  wrap.dataset.src = href;

  const icon = document.createElement('span');
  icon.classList.add('cm-lp-img-placeholder-icon');
  icon.innerHTML = IMAGE_ICON_SVG;
  wrap.appendChild(icon);

  const url = document.createElement('span');
  url.classList.add('cm-lp-img-placeholder-url');
  url.textContent = href;
  wrap.appendChild(url);

  if (showLoadBtn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.add('cm-lp-img-placeholder-load');
    btn.textContent = loadLabel;
    wrap.appendChild(btn);
  }

  return wrap;
}

function buildBlockedPlaceholder(notice: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.classList.add('cm-lp-img-placeholder', 'cm-lp-img-placeholder--blocked');

  const icon = document.createElement('span');
  icon.classList.add('cm-lp-img-placeholder-icon');
  icon.innerHTML = BLOCKED_ICON_SVG;
  wrap.appendChild(icon);

  const msg = document.createElement('span');
  msg.classList.add('cm-lp-img-placeholder-url');
  msg.textContent = notice;
  wrap.appendChild(msg);

  return wrap;
}

function attachLoadHandler(btn: HTMLButtonElement, href: string, view: EditorView): void {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch({
      effects: [loadImageEffect.of(href), rebuildLivePreview.of(null)]
    });
  });
}

/**
 * Move the editor caret inside the widget's markdown range on click.
 *
 * Without this, clicking an `<img>` (or a placeholder area where CM6
 * doesn't naturally land the caret — e.g. on top of the image bitmap)
 * leaves the cursor outside the `![alt](url)` range, so the widget
 * stays rendered and the user can't switch to raw markdown for editing.
 *
 * `view.posAtDOM(el)` returns the doc position of the widget's start.
 * Adding `+1` lands the caret one char inside the range, which makes
 * `isAnySelectionInRange(state, from, to)` return true and the next
 * `buildDecorations` skips this image — raw `![alt](url)` becomes
 * editable in place.
 */
function attachEditOnClick(el: HTMLElement, view: EditorView): void {
  el.addEventListener('click', (e) => {
    // The Load button has its own handler that stops propagation; don't
    // treat its click as an "edit this image" intent.
    if (e.defaultPrevented) return;
    if ((e.target as Element | null)?.closest('.cm-lp-img-placeholder-load')) return;
    const pos = view.posAtDOM(el);
    if (pos < 0) return;
    e.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: pos + 1, head: pos + 1 } });
  });
}
