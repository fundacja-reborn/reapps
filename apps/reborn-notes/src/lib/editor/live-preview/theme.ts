/**
 * CodeMirror theme for Live Preview mode.
 * Mirrors typography of MarkdownPreview.svelte so the editor and preview look alike.
 */
import { EditorView } from '@codemirror/view';

export const livePreviewTheme = EditorView.theme({
  // Use proportional Roboto in Live Preview so the view mirrors MarkdownPreview.
  // Markdown (raw) mode keeps the global monospace stack from app.css.
  '.cm-content': {
    fontFamily:
      "'Roboto', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
  },

  // Headings — applied via Decoration.line on the heading line element.
  // NOTE: use padding (not margin) — CM6 measures `.cm-line` via
  // getBoundingClientRect() which excludes margins; vertical margins on lines
  // de-sync the height map and break posAtCoords (clicks land off-target).
  // The `& span { textDecoration: none }` overrides defaultHighlightStyle
  // which adds underline to tags.heading — Preview has no underline, so we
  // strip it here for visual parity.
  '.cm-lp-h1-line': {
    fontSize: '2rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h2-line': {
    fontSize: '1.625rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h3-line': {
    fontSize: '1.375rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h4-line': {
    fontSize: '1.125rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h5-line': {
    fontSize: '1rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h6-line': {
    fontSize: '0.9375rem',
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    color: 'var(--muted-foreground)',
    '& span': { textDecoration: 'none' }
  },

  // Desktop heading sizes — match MarkdownPreview.svelte (md: 768px+).
  '@media (min-width: 768px)': {
    '.cm-lp-h1-line': { fontSize: '1.875rem' },
    '.cm-lp-h2-line': { fontSize: '1.5rem' },
    '.cm-lp-h3-line': { fontSize: '1.25rem' },
    '.cm-lp-h4-line': { fontSize: '1.0625rem' },
    '.cm-lp-h5-line': { fontSize: '0.9375rem' },
    '.cm-lp-h6-line': { fontSize: '0.875rem' }
  },

  // Inline marks
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through' },
  '.cm-lp-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.875em',
    backgroundColor: 'var(--muted)',
    padding: '0.125em 0.25em',
    borderRadius: '0.25em'
  },

  // Link rendered by LinkWidget — clickable anchor
  '.cm-lp-link': {
    color: 'var(--primary)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer'
  },
  '.cm-lp-link:hover': { opacity: '0.8' },
  '.cm-lp-link.cm-note-link': {
    textDecorationStyle: 'dashed',
    textUnderlineOffset: '3px'
  },
  '.cm-lp-link-blocked': {
    color: 'var(--muted-foreground)',
    textDecoration: 'line-through',
    cursor: 'not-allowed'
  },

  // Blockquote — line-level border + indent
  '.cm-lp-blockquote-line': {
    borderLeft: '3px solid var(--border)',
    paddingLeft: '0.75em',
    color: 'var(--muted-foreground)',
    fontStyle: 'italic'
  },

  // Bullet list line — render a bullet via ::before
  '.cm-lp-bullet-line': {
    position: 'relative',
    paddingLeft: '1.5em'
  },
  '.cm-lp-bullet-line::before': {
    content: '"•"',
    position: 'absolute',
    left: '0.5em',
    color: 'var(--muted-foreground)'
  },

  // Ordered list line — keep marker visible, just indent slightly
  '.cm-lp-ordered-line': {
    paddingLeft: '0.5em'
  }
});
