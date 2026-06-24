/**
 * Scroll a rendered heading into view by its anchor id.
 *
 * Used for in-note `#anchor` links and the outline panel (same MarkdownPreview
 * instance), and for cross-note `note:UUID#anchor` links once the target note
 * has re-rendered (the page consumes a pending anchor in its preview-render
 * callback). Ids are stamped on headings by MarkdownPreview from
 * {@link extractHeadings}, so the `slug` passed here matches a heading's `id`.
 *
 * We compare `element.id` directly (rather than `querySelector('#slug')`) to
 * avoid having to CSS-escape slugs that contain Unicode letters - Polish /
 * German / French / Spanish headings produce ids like `bezpieczeństwo`.
 *
 * @returns true when a matching heading was found and scrolled.
 */
export function scrollToHeading(container: HTMLElement | null, slug: string): boolean {
  if (!container || !slug) return false;
  const headings = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    if (heading.id === slug) {
      heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return true;
    }
  }
  return false;
}
