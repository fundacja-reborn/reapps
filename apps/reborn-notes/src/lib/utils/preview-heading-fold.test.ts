// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyHeadingFolds,
  FOLD_CONTROL_SELECTOR,
  FOLD_HIDDEN_ATTR,
  FOLD_REVEAL_EVENT,
  foldsHiding,
  headingSection,
  headingTail,
  isFoldHidden,
  revealFolded
} from './preview-heading-fold';
import { scrollToHeading } from './heading-scroll';
import { collectPreviewAnchors } from './source-line';

const labels = { fold: 'Collapse section', unfold: 'Expand section' };

// The shape MarkdownPreview renders: flat blocks, ids already on the headings.
const NOTE = `
  <h1 id="title" dir="auto">Title</h1>
  <p id="intro">intro</p>
  <h2 id="first" dir="auto">First</h2>
  <p id="first-body">first body</p>
  <h3 id="detail" dir="auto">Detail</h3>
  <p id="detail-body">detail body</p>
  <div class="md-blank-lines" id="gap" aria-hidden="true"><br></div>
  <h2 id="second" dir="auto">Second</h2>
  <div class="code-block" id="code"><pre><code>x</code></pre></div>
  <h2 id="empty" dir="auto">Empty</h2>
  <h2 id="last" dir="auto">Last</h2>
  <p id="last-body">last body</p>
`;

function mount(html = NOTE): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const byId = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[id="${id}"]`)!;
const hiddenIds = (root: HTMLElement) =>
  [...root.querySelectorAll(`[${FOLD_HIDDEN_ATTR}]`)].map((el) => el.id);
const toggleOf = (root: HTMLElement, id: string) =>
  byId(root, id).querySelector<HTMLButtonElement>('.md-head-fold');
const markOf = (root: HTMLElement, id: string) =>
  byId(root, id).querySelector<HTMLButtonElement>('.md-head-fold-mark');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('headingSection', () => {
  it('runs to the next heading of the same or a higher level', () => {
    const root = mount();
    const ids = (id: string) => headingSection(byId(root, id)).map((el) => el.id);
    expect(ids('first')).toEqual(['first-body', 'detail', 'detail-body']);
    expect(ids('detail')).toEqual(['detail-body']);
    expect(ids('second')).toEqual(['code']);
    expect(ids('last')).toEqual(['last-body']);
  });

  it('takes the whole note under a single top heading', () => {
    const root = mount();
    expect(headingSection(byId(root, 'title'))).toHaveLength(11);
  });

  it('leaves blank-line spacers before the next heading out', () => {
    const root = mount();
    expect(headingSection(byId(root, 'first')).map((el) => el.id)).not.toContain('gap');
  });

  it('is empty for a heading with nothing under it and for a non-heading', () => {
    const root = mount();
    expect(headingSection(byId(root, 'empty'))).toEqual([]);
    expect(headingSection(byId(root, 'intro'))).toEqual([]);
  });
});

describe('applyHeadingFolds', () => {
  it('gives a chevron to every heading with something under it', () => {
    const root = mount();
    expect(applyHeadingFolds(root, new Set(), labels)).toBe(false);
    expect(toggleOf(root, 'first')).not.toBeNull();
    expect(toggleOf(root, 'empty')).toBeNull();
    const toggle = toggleOf(root, 'first')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse section');
    expect(toggle.type).toBe('button');
    expect(hiddenIds(root)).toEqual([]);
  });

  it('hides the section of a folded heading and shows the mark', () => {
    const root = mount();
    expect(applyHeadingFolds(root, new Set(['first']), labels)).toBe(true);
    expect(hiddenIds(root)).toEqual(['first-body', 'detail', 'detail-body']);
    const toggle = toggleOf(root, 'first')!;
    expect(toggle.classList.contains('is-folded')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand section');
    expect(markOf(root, 'first')!.getAttribute('aria-label')).toBe('Expand section');
    expect(markOf(root, 'second')).toBeNull();
  });

  it('adds no text to a heading, folded or not', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    expect(byId(root, 'first').textContent).toBe('First');
    expect(byId(root, 'second').textContent).toBe('Second');
  });

  it('opens the section again and removes the mark', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    expect(applyHeadingFolds(root, new Set(), labels)).toBe(true);
    expect(hiddenIds(root)).toEqual([]);
    expect(markOf(root, 'first')).toBeNull();
    expect(toggleOf(root, 'first')!.classList.contains('is-folded')).toBe(false);
  });

  it('moves the focus from the mark to the chevron when the mark goes away', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    markOf(root, 'first')!.focus();
    applyHeadingFolds(root, new Set(), labels);
    expect(document.activeElement).toBe(toggleOf(root, 'first'));
  });

  it('can be run again without adding controls or reporting a change', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first', 'last']), labels);
    expect(applyHeadingFolds(root, new Set(['first', 'last']), labels)).toBe(false);
    expect(root.querySelectorAll('.md-head-fold')).toHaveLength(5);
    expect(root.querySelectorAll('.md-head-fold-mark')).toHaveLength(2);
  });

  it('keeps an inner section hidden while its outer one is folded', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first', 'detail']), labels);
    expect(hiddenIds(root)).toEqual(['first-body', 'detail', 'detail-body']);
    // Opening the outer one shows the inner heading, still folded.
    applyHeadingFolds(root, new Set(['detail']), labels);
    expect(hiddenIds(root)).toEqual(['detail-body']);
  });

  it('ignores a slug that is not in the note', () => {
    const root = mount();
    expect(applyHeadingFolds(root, new Set(['gone']), labels)).toBe(false);
    expect(hiddenIds(root)).toEqual([]);
  });

  it('follows a change of language', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    applyHeadingFolds(root, new Set(['first']), { fold: 'Zwiń sekcję', unfold: 'Rozwiń sekcję' });
    expect(toggleOf(root, 'first')!.title).toBe('Rozwiń sekcję');
    expect(markOf(root, 'first')!.title).toBe('Rozwiń sekcję');
    expect(toggleOf(root, 'second')!.title).toBe('Zwiń sekcję');
  });

  it('marks the chevron of a right-to-left heading', () => {
    const root = mount('<h2 id="a" dir="auto">عنوان</h2><p>نص</p><h2 id="b" dir="auto">Title</h2><p>x</p>');
    applyHeadingFolds(root, new Set(), labels);
    expect(toggleOf(root, 'a')!.classList.contains('is-rtl')).toBe(true);
    expect(toggleOf(root, 'b')!.classList.contains('is-rtl')).toBe(false);
  });

  it('folds a heading inside a quote within the quote', () => {
    const root = mount(
      '<blockquote><h2 id="q">Quoted</h2><p id="q-body">text</p></blockquote><p id="after">after</p>'
    );
    applyHeadingFolds(root, new Set(['q']), labels);
    expect(hiddenIds(root)).toEqual(['q-body']);
  });

  it('puts the controls where a click can find them', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    const controls = [...byId(root, 'first').querySelectorAll(FOLD_CONTROL_SELECTOR)];
    expect(controls).toEqual([toggleOf(root, 'first'), markOf(root, 'first')]);
    expect(controls.every((el) => el.closest('h1, h2, h3, h4, h5, h6')?.id === 'first')).toBe(true);
  });

  // The holder is what CSS glues to the last word of the heading, so buttons
  // never wrap to a line of their own. Buttons outside it would wrap again.
  it('keeps the controls of a heading in one holder at its end', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    applyHeadingFolds(root, new Set(['first']), labels);
    const heading = byId(root, 'first');
    const tails = heading.querySelectorAll('.md-head-tail');
    expect(tails).toHaveLength(1);
    expect(heading.lastElementChild).toBe(tails[0]);
    expect([...tails[0].children]).toEqual([toggleOf(root, 'first'), markOf(root, 'first')]);
    expect(heading.textContent).toBe('First');
  });

  it('shares the holder with a button that is already in it', () => {
    const root = mount();
    const heading = byId(root, 'first');
    const link = document.createElement('button');
    link.className = 'md-head-anchor';
    headingTail(heading).appendChild(link);
    applyHeadingFolds(root, new Set(), labels);
    expect(heading.querySelectorAll('.md-head-tail')).toHaveLength(1);
    expect([...headingTail(heading).children]).toEqual([link, toggleOf(root, 'first')]);
  });

  it('drops the holder of a heading that lost its section, unless a button is left', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(), labels);
    const last = byId(root, 'last');
    const first = byId(root, 'first');
    const link = document.createElement('button');
    link.className = 'md-head-anchor';
    headingTail(first).prepend(link);
    byId(root, 'last-body').remove();
    for (const el of headingSection(first)) el.remove();
    applyHeadingFolds(root, new Set(), labels);
    expect(last.querySelector('.md-head-tail')).toBeNull();
    expect([...headingTail(first).children]).toEqual([link]);
  });

  it('gives a heading with no section no holder', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(), labels);
    expect(byId(root, 'empty').querySelector('.md-head-tail')).toBeNull();
  });
});

describe('foldsHiding', () => {
  it('lists every folded heading that hides the target', () => {
    const root = mount();
    const folded = new Set(['title', 'first', 'detail', 'last']);
    applyHeadingFolds(root, folded, labels);
    expect(foldsHiding(root, byId(root, 'detail-body'), folded)).toEqual(['title', 'first', 'detail']);
    expect(foldsHiding(root, byId(root, 'detail'), folded)).toEqual(['title', 'first']);
    expect(foldsHiding(root, byId(root, 'title'), folded)).toEqual([]);
  });

  it('finds a target deep inside a hidden block', () => {
    const root = mount();
    const folded = new Set(['second']);
    applyHeadingFolds(root, folded, labels);
    expect(foldsHiding(root, root.querySelector('#code code')!, folded)).toEqual(['second']);
  });
});

describe('revealFolded', () => {
  it('asks the preview only for a hidden element', () => {
    const root = mount();
    applyHeadingFolds(root, new Set(['first']), labels);
    const onReveal = vi.fn();
    root.addEventListener(FOLD_REVEAL_EVENT, onReveal);

    revealFolded(byId(root, 'second'));
    revealFolded(null);
    expect(onReveal).not.toHaveBeenCalled();

    expect(isFoldHidden(byId(root, 'detail-body'))).toBe(true);
    revealFolded(byId(root, 'detail-body'));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal.mock.calls[0][0].target).toBe(byId(root, 'detail-body'));
  });
});

describe('scrollToHeading into a folded section', () => {
  it('has the section opened before it scrolls', () => {
    const root = mount();
    let folded = new Set(['first']);
    applyHeadingFolds(root, folded, labels);
    // What MarkdownPreview does on the event.
    root.addEventListener(FOLD_REVEAL_EVENT, (e) => {
      const hiding = new Set(foldsHiding(root, e.target as Element, folded));
      folded = new Set([...folded].filter((slug) => !hiding.has(slug)));
      applyHeadingFolds(root, folded, labels);
    });
    const hiddenAtScroll: boolean[] = [];
    const target = byId(root, 'detail');
    target.scrollIntoView = () => hiddenAtScroll.push(isFoldHidden(target));

    expect(scrollToHeading(root, 'detail')).toBe(true);
    expect(hiddenAtScroll).toEqual([false]);
    expect(hiddenIds(root)).toEqual([]);
  });
});

describe('collectPreviewAnchors with a folded section', () => {
  it('skips the blocks a fold hides', () => {
    const root = mount(`
      <h2 id="a" data-source-line="1" data-source-line-end="1">A</h2>
      <p data-source-line="2" data-source-line-end="2">hidden</p>
      <h2 id="b" data-source-line="4" data-source-line-end="4">B</h2>
      <p data-source-line="5" data-source-line-end="5">shown</p>
    `);
    expect(collectPreviewAnchors(root).map((a) => a.startLine)).toEqual([1, 2, 4, 5]);
    applyHeadingFolds(root, new Set(['a']), labels);
    expect(collectPreviewAnchors(root).map((a) => a.startLine)).toEqual([1, 4, 5]);
  });
});
