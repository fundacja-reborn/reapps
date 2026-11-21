/**
 * Collapsible sections in the rendered preview (issue #582).
 *
 * The preview half of `editor/heading-fold.ts`: every heading with something
 * under it gets the same chevron at the end of its line, and a folded section
 * leaves the same "…" mark. Which sections are folded is not decided here: the
 * owner passes the slugs in (`stores/heading-folds.store.ts` holds them for the
 * editor and the preview together) and gets a click back.
 *
 * The rendered note is flat HTML (`<h2>` followed by its paragraphs as
 * siblings), so folding marks the siblings up to the next heading of the same
 * or a higher level with {@link FOLD_HIDDEN_ATTR}; CSS hides them. The content
 * stays in the DOM: `{@html}` owns it, and a fold has to survive without
 * re-rendering the note. The function is idempotent - it is run again after
 * every render and every change of the folded set.
 *
 * No editor imports here: scroll-sync and the heading scroll helper load this
 * module for the hidden marker.
 */
import { detectTextDirection } from '@reborn/i18n/direction';

/**
 * Lucide "chevron-down" (16px, follows the text colour): the fold button of
 * the editor and of the preview. Static markup, never note content.
 */
export const FOLD_CHEVRON_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/** On every element a folded section hides (CSS: `display: none`). */
export const FOLD_HIDDEN_ATTR = 'data-fold-hidden';
/** Bubbling event that asks the preview to open the sections hiding its target. */
export const FOLD_REVEAL_EVENT = 'rn-fold-reveal';

const TOGGLE_CLASS = 'md-head-fold';
const MARK_CLASS = 'md-head-fold-mark';
/** Clicks on either of these toggle the section of the heading they sit in. */
export const FOLD_CONTROL_SELECTOR = `.${TOGGLE_CLASS}, .${MARK_CLASS}`;

/**
 * Holds the buttons at the end of a heading: the copy-link button of the
 * owner's preview and the fold controls. CSS keeps it on one line and glues it
 * to the last word of the heading, so a heading that fills its line takes that
 * word down with the buttons instead of leaving them on a line of their own.
 */
const TAIL_CLASS = 'md-head-tail';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
/** Spacer block for extra blank lines kept in the rendered note (blank-lines.ts). */
const BLANK_LINES_CLASS = 'md-blank-lines';

export interface PreviewFoldLabels {
  /** aria-label / tooltip of the chevron on an open section. */
  fold: string;
  /** aria-label / tooltip of the chevron and the "…" mark on a folded section. */
  unfold: string;
}

function headingLevel(el: Element): number | null {
  const match = /^H([1-6])$/.exec(el.tagName);
  return match ? Number(match[1]) : null;
}

/**
 * What folding a heading hides: its following siblings up to the next heading
 * of the same or a higher level - the rule of the editor. Blank-line spacers at
 * the end stay visible, as the blank lines before the next heading do there.
 */
export function headingSection(heading: Element): HTMLElement[] {
  const level = headingLevel(heading);
  if (level == null) return [];
  const section: HTMLElement[] = [];
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    const next = headingLevel(el);
    if (next != null && next <= level) break;
    section.push(el as HTMLElement);
  }
  while (section.length && section[section.length - 1].classList.contains(BLANK_LINES_CLASS)) {
    section.pop();
  }
  return section;
}

function existingTail(heading: Element): HTMLElement | null {
  for (const child of heading.children) {
    if (child.classList.contains(TAIL_CLASS)) return child as HTMLElement;
  }
  return null;
}

/**
 * The element at the end of `heading` that its buttons go into, created on
 * first use. It carries no text, so the heading's text stays the heading's.
 */
export function headingTail(heading: HTMLElement): HTMLElement {
  let tail = existingTail(heading);
  if (!tail) {
    tail = document.createElement('span');
    tail.className = TAIL_CLASS;
    heading.appendChild(tail);
  }
  return tail;
}

function childControl(heading: Element, className: string): HTMLButtonElement | null {
  const tail = existingTail(heading);
  if (!tail) return null;
  for (const child of tail.children) {
    if (child.classList.contains(className)) return child as HTMLButtonElement;
  }
  return null;
}

function setLabel(button: HTMLButtonElement, label: string): void {
  if (button.title !== label) button.title = label;
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
}

/**
 * Give every heading with a section its chevron and hide the sections whose
 * heading id is in `folded`. Run after the heading ids are stamped.
 *
 * @returns true when an element was hidden or shown, i.e. the layout changed
 *   and anything that measured the preview (scroll-sync anchors) is stale.
 */
export function applyHeadingFolds(
  root: HTMLElement,
  folded: ReadonlySet<string>,
  labels: PreviewFoldLabels
): boolean {
  const hide = new Set<Element>();

  for (const heading of root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    const section = headingSection(heading);
    let toggle = childControl(heading, TOGGLE_CLASS);
    let mark = childControl(heading, MARK_CLASS);
    if (section.length === 0) {
      toggle?.remove();
      mark?.remove();
      // Nothing left in it (no copy-link button either): drop the holder too.
      const tail = existingTail(heading);
      if (tail && tail.childElementCount === 0) tail.remove();
      continue;
    }

    const isFolded = heading.id !== '' && folded.has(heading.id);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = TOGGLE_CLASS;
      // Trusted constant, never note content.
      toggle.innerHTML = FOLD_CHEVRON_ICON;
      // The heading's own text decides which way a folded chevron points
      // (`dir="auto"` on the heading: first strong character). Read before the
      // controls are in, although they carry no text.
      toggle.classList.toggle('is-rtl', detectTextDirection(heading.textContent ?? '') === 'rtl');
      headingTail(heading).appendChild(toggle);
    }
    toggle.classList.toggle('is-folded', isFolded);
    toggle.setAttribute('aria-expanded', isFolded ? 'false' : 'true');
    setLabel(toggle, isFolded ? labels.unfold : labels.fold);

    if (isFolded) {
      if (!mark) {
        // The "…" itself is drawn in CSS, so the heading's text stays the
        // heading's text (search in the note reads text nodes).
        mark = document.createElement('button');
        mark.type = 'button';
        mark.className = MARK_CLASS;
        headingTail(heading).appendChild(mark);
      }
      setLabel(mark, labels.unfold);
      for (const el of section) hide.add(el);
    } else if (mark) {
      // Opened from the mark with the keyboard: the mark goes away, so hand the
      // focus to the chevron instead of dropping it on the page.
      if (mark === document.activeElement) toggle.focus();
      mark.remove();
    }
  }

  let changed = false;
  for (const el of root.querySelectorAll(`[${FOLD_HIDDEN_ATTR}]`)) {
    if (!hide.has(el)) {
      el.removeAttribute(FOLD_HIDDEN_ATTR);
      changed = true;
    }
  }
  for (const el of hide) {
    if (!el.hasAttribute(FOLD_HIDDEN_ATTR)) {
      el.setAttribute(FOLD_HIDDEN_ATTR, '');
      changed = true;
    }
  }
  return changed;
}

/** True when `el` is inside (or is) something a folded section hides. */
export function isFoldHidden(el: Element | null | undefined): boolean {
  return !!el?.closest(`[${FOLD_HIDDEN_ATTR}]`);
}

/**
 * Ids of the folded headings that hide `target`: every one of them has to open
 * for the target to show (a folded sub-section inside a folded section).
 */
export function foldsHiding(
  root: HTMLElement,
  target: Element,
  folded: ReadonlySet<string>
): string[] {
  const hiding: string[] = [];
  if (folded.size === 0) return hiding;
  for (const heading of root.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (!folded.has(heading.id)) continue;
    if (headingSection(heading).some((el) => el === target || el.contains(target))) {
      hiding.push(heading.id);
    }
  }
  return hiding;
}

/**
 * Ask the preview to open whatever folded section hides `el`, before scrolling
 * to it (an outline or table-of-contents jump, a search match). The preview
 * handles the event synchronously, so the element has a box when this returns.
 * No-op for an element that is not hidden.
 */
export function revealFolded(el: Element | null | undefined): void {
  if (!el || !isFoldHidden(el)) return;
  el.dispatchEvent(new CustomEvent(FOLD_REVEAL_EVENT, { bubbles: true }));
}
