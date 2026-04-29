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
  },

  // ─── Fenced code blocks ──────────────────────────────────────
  // Cursor outside: replaced with <pre class="cm-lp-codeblock">.
  // Margin must stay 0 so the block sits flush — same height-map rule
  // as line decorations.
  '.cm-lp-codeblock': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.875em',
    lineHeight: '1.5',
    backgroundColor: 'var(--muted)',
    color: 'var(--foreground)',
    padding: '0.75em 1em',
    margin: '0',
    borderRadius: '0.5em',
    overflowX: 'auto',
    whiteSpace: 'pre'
  },
  '.cm-lp-codeblock code': {
    fontFamily: 'inherit',
    background: 'transparent',
    padding: '0',
    fontSize: 'inherit'
  },

  // Cursor inside: per-line decoration so the raw fences and body share
  // a continuous code-block look. Padding-only (no margin) — see header
  // note about CM6 height map.
  '.cm-lp-code-line': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.875em',
    backgroundColor: 'var(--muted)',
    paddingLeft: '1em',
    paddingRight: '1em'
  },
  '.cm-lp-code-line-first': {
    paddingTop: '0.5em',
    borderTopLeftRadius: '0.5em',
    borderTopRightRadius: '0.5em'
  },
  '.cm-lp-code-line-last': {
    paddingBottom: '0.5em',
    borderBottomLeftRadius: '0.5em',
    borderBottomRightRadius: '0.5em'
  },

  // ─── Syntax highlight tokens (for CodeBlockWidget) ───────────
  // Stable class names from `@lezer/highlight#classHighlighter`.
  // Palette is intentionally muted; mirrors @codemirror/language's
  // defaultHighlightStyle so the rendered widget and the raw
  // (cursor-inside) view stay visually close.
  '.cm-lp-codeblock .tok-keyword': { color: '#708' },
  '.cm-lp-codeblock .tok-controlKeyword': { color: '#708' },
  '.cm-lp-codeblock .tok-moduleKeyword': { color: '#708' },
  '.cm-lp-codeblock .tok-operatorKeyword': { color: '#708' },
  '.cm-lp-codeblock .tok-definitionKeyword': { color: '#708' },
  '.cm-lp-codeblock .tok-atom': { color: '#219' },
  '.cm-lp-codeblock .tok-bool': { color: '#219' },
  '.cm-lp-codeblock .tok-number': { color: '#164' },
  '.cm-lp-codeblock .tok-string': { color: '#a11' },
  '.cm-lp-codeblock .tok-special.tok-string': { color: '#e40' },
  '.cm-lp-codeblock .tok-regexp': { color: '#e40' },
  '.cm-lp-codeblock .tok-escape': { color: '#e40' },
  '.cm-lp-codeblock .tok-comment': { color: '#940', fontStyle: 'italic' },
  '.cm-lp-codeblock .tok-lineComment': { color: '#940', fontStyle: 'italic' },
  '.cm-lp-codeblock .tok-blockComment': { color: '#940', fontStyle: 'italic' },
  '.cm-lp-codeblock .tok-meta': { color: '#555' },
  '.cm-lp-codeblock .tok-name': { color: 'inherit' },
  '.cm-lp-codeblock .tok-variableName': { color: '#00f' },
  '.cm-lp-codeblock .tok-typeName': { color: '#085' },
  '.cm-lp-codeblock .tok-className': { color: '#167' },
  '.cm-lp-codeblock .tok-propertyName': { color: '#00c' },
  '.cm-lp-codeblock .tok-attributeName': { color: '#00c' },
  '.cm-lp-codeblock .tok-tagName': { color: '#170' },
  '.cm-lp-codeblock .tok-labelName': { color: '#170' },
  '.cm-lp-codeblock .tok-namespace': { color: '#167' },
  '.cm-lp-codeblock .tok-macroName': { color: '#085' },
  '.cm-lp-codeblock .tok-function': { color: 'inherit' },
  '.cm-lp-codeblock .tok-link': { color: '#219', textDecoration: 'underline' },
  '.cm-lp-codeblock .tok-heading': { fontWeight: '700' },
  '.cm-lp-codeblock .tok-emphasis': { fontStyle: 'italic' },
  '.cm-lp-codeblock .tok-strong': { fontWeight: '700' },
  '.cm-lp-codeblock .tok-deleted': {
    color: '#a11',
    textDecoration: 'line-through'
  },
  '.cm-lp-codeblock .tok-inserted': { color: '#164' },
  '.cm-lp-codeblock .tok-invalid': { color: '#f00' },

  // ─── GFM Tables (always editable, Obsidian-style) ─────────────
  // Block-replace widget. Margin must stay 0 — same height-map rule
  // as fenced code blocks. Padding lives on the wrapper instead.
  '.cm-lp-table-wrap': {
    margin: '0',
    padding: '0.25em 0',
    overflowX: 'auto'
  },
  '.cm-lp-table': {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9375rem',
    tableLayout: 'auto'
  },
  '.cm-lp-table th, .cm-lp-table td': {
    padding: '0.5em 0.75em',
    border: '1px solid var(--border)',
    textAlign: 'left',
    verticalAlign: 'top',
    minWidth: '4em',
    outline: 'none',
    // Render Shift+Enter line breaks (`<br>` inside the cell) as visible
    // newlines without collapsing whitespace.
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  '.cm-lp-table th': {
    backgroundColor: 'var(--muted)',
    fontWeight: '600'
  },
  // Focus highlight on the active cell. Inset ring so it doesn't shift the
  // table layout when entering/leaving cells.
  '.cm-lp-table th:focus, .cm-lp-table td:focus': {
    boxShadow: 'inset 0 0 0 2px var(--ring, var(--primary))',
    backgroundColor: 'color-mix(in srgb, var(--primary) 8%, transparent)'
  }

  // Dark-mode token overrides live in NoteEditor.svelte's `<style>`
  // (`:global(.dark .cm-lp-codeblock .tok-*)`). They need a `.dark`
  // ancestor selector, which CM6 themes can't express — themes scope
  // every key under the editor root via a generated class.
});
