/**
 * Live Preview "copy link to this heading" button.
 *
 * Emitted at the end of every ATX heading line in Live Preview. Hidden until
 * the heading line is hovered or the caret sits on it (the caret rule covers
 * touch, where there is no hover), then pinned to the line's top-right corner -
 * the same affordance pattern as the fenced-code copy button.
 *
 * The widget is inert DOM: it only carries the heading's slug + text as data
 * attributes. The click is wired in `NoteEditor.svelte` (the Svelte layer holds
 * the note's id, the i18n `$t`, the clipboard helper and the toast store), which
 * builds the internal link `[text](note:UUID#slug)` and copies it. Keeping the
 * note id out of the widget means a note switch never bakes a stale id into the
 * decoration - the id is read fresh from the component closure on each click.
 */
import { WidgetType } from '@codemirror/view';

// Lucide-style "link" glyph (16px, `stroke="currentColor"` so it follows the
// button text colour). Static, self-contained, never user input - inlined as a
// string for the `innerHTML` (DOM) call site, same as the code-copy icon.
export const HEADING_LINK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

export class HeadingAnchorWidget extends WidgetType {
  constructor(
    /** Deduplicated anchor id of the heading (same source as the TOC/preview). */
    readonly slug: string,
    /** Heading text, used as the copied link's label. */
    readonly text: string,
    /** i18n aria-label / tooltip for the button. */
    readonly label: string
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof HeadingAnchorWidget &&
      other.slug === this.slug &&
      other.text === this.text &&
      other.label === this.label
    );
  }

  toDOM(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-lp-head-anchor';
    btn.title = this.label;
    btn.setAttribute('aria-label', this.label);
    // `dataset` assignment is escaped by the DOM - safe for arbitrary heading
    // text. The click handler in NoteEditor reads these back.
    btn.dataset.headingSlug = this.slug;
    btn.dataset.headingText = this.text;
    btn.innerHTML = HEADING_LINK_ICON;
    // Stop CM6 from treating the press as a caret move into the heading (which
    // would swap the rendered line for raw markdown before our `click` fires).
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return btn;
  }

  ignoreEvent(): boolean {
    // Let the click bubble to NoteEditor's `domEventHandlers`.
    return false;
  }
}
