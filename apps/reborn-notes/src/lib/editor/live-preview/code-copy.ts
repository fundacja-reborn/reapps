/**
 * Shared "copy code" button assets + behaviour for fenced code blocks.
 *
 * Both Preview (MarkdownPreview's `{@html}` string) and Live Preview
 * (`CodeBlockWidget` DOM) render a copy button over each code block's
 * top-right corner. The icon markup is a static, self-contained SVG (no
 * external deps, never user input) so the same glyph appears in the rendered
 * HTML string and the editor widget DOM. Clicking writes the raw code to the
 * clipboard and flips the button to a transient checkmark for ~1.6s.
 *
 * Labels are passed in by the caller so the i18n source of truth stays in the
 * Svelte/i18n layer rather than being duplicated here.
 */

import { copyText } from '$lib/utils/clipboard';

// Clipboard + check icons (Lucide-style, 16px, `stroke="currentColor"` so they
// follow the button's text colour). Inlined as strings for the HTML-string
// (Preview) and DOM (`innerHTML`, Live Preview) call sites alike.
export const CODE_COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

export const CODE_CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

export interface CodeCopyLabels {
  /** Default state — also the post-revert title/aria-label. */
  copy: string;
  /** Shown while the transient checkmark is visible. */
  copied: string;
}

// Per-button revert timer. A WeakMap (not a `data-` attribute) keeps the timer
// id strongly typed across DOM/Node `setTimeout` return types and lets the
// button be GC'd with its entry when the widget is torn down.
const revertTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Write `code` to the clipboard and show a transient checkmark on `btn`.
 * Safe to call repeatedly - a pending revert timer is cleared first. Copies via
 * `copyText` (async Clipboard API with an execCommand fallback for the native
 * WebView); silently no-ops only if both paths fail, leaving the button in its
 * default state.
 */
export async function copyCodeFromButton(
  btn: HTMLElement,
  code: string,
  labels: CodeCopyLabels
): Promise<void> {
  if (!(await copyText(code))) return;
  showCopied(btn, labels);
}

function showCopied(btn: HTMLElement, labels: CodeCopyLabels): void {
  btn.innerHTML = CODE_CHECK_ICON;
  btn.title = labels.copied;
  btn.setAttribute('aria-label', labels.copied);
  btn.classList.add('is-copied');

  const prev = revertTimers.get(btn);
  if (prev) clearTimeout(prev);
  const id = setTimeout(() => {
    btn.innerHTML = CODE_COPY_ICON;
    btn.title = labels.copy;
    btn.setAttribute('aria-label', labels.copy);
    btn.classList.remove('is-copied');
    revertTimers.delete(btn);
  }, 1600);
  revertTimers.set(btn, id);
}
