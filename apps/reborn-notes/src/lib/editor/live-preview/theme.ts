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

  // Visible markdown markers on the actively-edited line. Emitted by
  // `buildDecorations` as `Decoration.mark({ class: 'cm-lp-mark' })` on the
  // ranges that would otherwise be hidden (`#`, `**`, `_`, `~~`, `` ` ``,
  // `> `, `- `, `- [ ] ` / `- [x] `).
  //
  // Color goal: clearly subordinate to body text (Obsidian-style), so the eye
  // lands on content. `--muted-foreground` alone (oklch ~0.556 light / ~0.65
  // dark) is "medium gray" - too close in weight to the body. We layer
  // `opacity: 0.5` on top so the marker reads as light gray in light mode and
  // dim gray in dark mode, scaling against `--background` rather than being
  // pinned to one literal lightness value.
  //
  // The `, .cm-lp-mark *` half of the selector handles CM6's habit of wrapping
  // the highlight tokens (heading/processingInstruction tag spans from
  // `defaultHighlightStyle`) inside our `Decoration.mark` span. If we only
  // styled `.cm-lp-mark`, the inner highlight span's own color rule could
  // shadow inheritance from the outer wrapper. `opacity` stays on the outer
  // only - applying it to descendants too would double-multiply.
  '.cm-lp-mark, .cm-lp-mark *': { color: 'var(--muted-foreground)' },
  '.cm-lp-mark': { opacity: '0.5' },

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

  // Bullet list — depth-aware padding + ::before bullet.
  //
  // Tapered ramp (mirrored in MarkdownPreview.svelte's `[data-d{N}]` rules):
  //   d1 → 1.5em (preserves the historical first-level indent)
  //   d2 → 4em   (krok +2.5em — a noticeable visual step so a nested item
  //               doesn't sit in the same column as the parent's content)
  //   d3..d6 → +1.5em per level (5.5, 7, 8.5, 10)
  //   d7..d12 → +0.75em per level (10.75, 11.5, 12.25, 13, 13.75, 14.5)
  //   clamp at d12 ≈ 14.5em (~232px on a 360px viewport — usable on mobile,
  //   deeper trees are vanishingly rare in real notes)
  //
  // Each ListItem gets `cm-lp-bullet-line cm-lp-bullet-d{N}` from
  // `decorations.ts` (N = BulletList/OrderedList ancestor count, clamped to
  // MAX_LIST_DEPTH). The bullet `::before` sits 1em left of the content,
  // giving every level the same marker-to-text relationship while the
  // contents themselves shift right as nesting deepens.
  '.cm-lp-bullet-line': {
    position: 'relative'
  },
  '.cm-lp-bullet-line::before': {
    content: '"•"',
    position: 'absolute',
    color: 'var(--muted-foreground)'
  },
  '.cm-lp-bullet-d1': { paddingLeft: '1.5em' },
  '.cm-lp-bullet-d1::before': { left: '0.5em' },
  '.cm-lp-bullet-d2': { paddingLeft: '4em' },
  '.cm-lp-bullet-d2::before': { left: '3em' },
  '.cm-lp-bullet-d3': { paddingLeft: '5.5em' },
  '.cm-lp-bullet-d3::before': { left: '4.5em' },
  '.cm-lp-bullet-d4': { paddingLeft: '7em' },
  '.cm-lp-bullet-d4::before': { left: '6em' },
  '.cm-lp-bullet-d5': { paddingLeft: '8.5em' },
  '.cm-lp-bullet-d5::before': { left: '7.5em' },
  '.cm-lp-bullet-d6': { paddingLeft: '10em' },
  '.cm-lp-bullet-d6::before': { left: '9em' },
  '.cm-lp-bullet-d7': { paddingLeft: '10.75em' },
  '.cm-lp-bullet-d7::before': { left: '9.75em' },
  '.cm-lp-bullet-d8': { paddingLeft: '11.5em' },
  '.cm-lp-bullet-d8::before': { left: '10.5em' },
  '.cm-lp-bullet-d9': { paddingLeft: '12.25em' },
  '.cm-lp-bullet-d9::before': { left: '11.25em' },
  '.cm-lp-bullet-d10': { paddingLeft: '13em' },
  '.cm-lp-bullet-d10::before': { left: '12em' },
  '.cm-lp-bullet-d11': { paddingLeft: '13.75em' },
  '.cm-lp-bullet-d11::before': { left: '12.75em' },
  '.cm-lp-bullet-d12': { paddingLeft: '14.5em' },
  '.cm-lp-bullet-d12::before': { left: '13.5em' },

  // Ordered list — same indent rhythm but no ::before (number stays in source).
  '.cm-lp-ordered-line': {},
  '.cm-lp-ordered-d1': { paddingLeft: '1.5em' },
  '.cm-lp-ordered-d2': { paddingLeft: '4em' },
  '.cm-lp-ordered-d3': { paddingLeft: '5.5em' },
  '.cm-lp-ordered-d4': { paddingLeft: '7em' },
  '.cm-lp-ordered-d5': { paddingLeft: '8.5em' },
  '.cm-lp-ordered-d6': { paddingLeft: '10em' },
  '.cm-lp-ordered-d7': { paddingLeft: '10.75em' },
  '.cm-lp-ordered-d8': { paddingLeft: '11.5em' },
  '.cm-lp-ordered-d9': { paddingLeft: '12.25em' },
  '.cm-lp-ordered-d10': { paddingLeft: '13em' },
  '.cm-lp-ordered-d11': { paddingLeft: '13.75em' },
  '.cm-lp-ordered-d12': { paddingLeft: '14.5em' },

  // ─── GFM task list (- [ ] / - [x]) ───────────────────────────
  // Same depth ramp as bullets so mixed bullet/task siblings line up. No
  // `::before` content — the `TaskCheckboxWidget` <input> sits in the marker
  // zone instead. Completed lines (`[x]`) get an extra `cm-lp-task-checked`
  // for strikethrough + muted color.
  '.cm-lp-task-line': {
    position: 'relative'
  },
  '.cm-lp-task-d1': { paddingLeft: '1.5em' },
  '.cm-lp-task-d2': { paddingLeft: '4em' },
  '.cm-lp-task-d3': { paddingLeft: '5.5em' },
  '.cm-lp-task-d4': { paddingLeft: '7em' },
  '.cm-lp-task-d5': { paddingLeft: '8.5em' },
  '.cm-lp-task-d6': { paddingLeft: '10em' },
  '.cm-lp-task-d7': { paddingLeft: '10.75em' },
  '.cm-lp-task-d8': { paddingLeft: '11.5em' },
  '.cm-lp-task-d9': { paddingLeft: '12.25em' },
  '.cm-lp-task-d10': { paddingLeft: '13em' },
  '.cm-lp-task-d11': { paddingLeft: '13.75em' },
  '.cm-lp-task-d12': { paddingLeft: '14.5em' },
  '.cm-lp-task-checked': {
    textDecoration: 'line-through',
    color: 'var(--muted-foreground)',
    opacity: '0.7'
  },
  '.cm-lp-task-checkbox': {
    marginRight: '0.4em',
    cursor: 'pointer',
    accentColor: 'var(--primary)',
    verticalAlign: 'middle',
    transform: 'translateY(-1px)'
  },

  // ─── Fenced code blocks ──────────────────────────────────────
  // Cursor outside: replaced with <div class="cm-lp-codeblock-wrap"><pre>.
  // The wrapper is the horizontal scroll container; its `overflow-x: auto`
  // creates a new BFC that prevents the <pre>'s `white-space: pre` intrinsic
  // width from propagating up to `.cm-content` and overflowing the viewport
  // on mobile (sibling paragraphs/headings would otherwise stretch with it).
  // Margin must stay 0 — same height-map rule as line decorations.
  // Non-scrolling positioning context for the copy button. Margin must stay 0
  // (same CM6 height-map rule as line decorations); the inner wrap owns the
  // horizontal scroll so the absolutely-placed button stays pinned top-right.
  '.cm-lp-codeblock-outer': {
    position: 'relative',
    margin: '0',
    maxWidth: '100%'
  },
  '.cm-lp-codeblock-wrap': {
    margin: '0',
    maxWidth: '100%',
    overflowX: 'auto',
    borderRadius: '0.5em',
    // Improves single-finger horizontal swipe on touch devices without
    // hijacking vertical page scroll.
    touchAction: 'pan-x pan-y'
  },
  '.cm-lp-codeblock': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.875em',
    lineHeight: '1.5',
    backgroundColor: 'var(--muted)',
    color: 'var(--foreground)',
    padding: '0.75em 1em',
    margin: '0',
    borderRadius: '0.5em',
    whiteSpace: 'pre',
    // Keep code selectable inside the widget (the rendered block sits in the
    // contenteditable surface; be explicit rather than inherit CM6 defaults).
    userSelect: 'text',
    WebkitUserSelect: 'text',
    // `width: max-content` lets the <pre> grow to its longest line so the
    // wrapper's `overflow-x: auto` actually engages. `min-width: 100%` keeps
    // the muted background filling the wrapper width when code is short.
    width: 'max-content',
    minWidth: '100%',
    boxSizing: 'border-box'
  },
  '.cm-lp-codeblock code': {
    fontFamily: 'inherit',
    background: 'transparent',
    padding: '0',
    fontSize: 'inherit'
  },

  // Copy button — pinned to the block's top-right, over the <pre>. Colours use
  // app CSS vars so the button tracks light/dark via the cascade (the CM6
  // theme stylesheet can't target `.dark` on <html> directly).
  '.cm-lp-code-copy': {
    position: 'absolute',
    top: '0.4em',
    right: '0.4em',
    zIndex: '1',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.9em',
    height: '1.9em',
    padding: '0',
    border: '1px solid var(--border)',
    borderRadius: '0.375em',
    background: 'var(--background)',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    opacity: '0.55',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease'
  },
  '.cm-lp-codeblock-outer:hover .cm-lp-code-copy': { opacity: '1', color: 'var(--foreground)' },
  '.cm-lp-code-copy:hover': { opacity: '1', color: 'var(--foreground)' },
  '.cm-lp-code-copy:focus-visible': { opacity: '1', color: 'var(--foreground)' },
  '.cm-lp-code-copy.is-copied': {
    opacity: '1',
    color: '#16a34a',
    borderColor: '#16a34a'
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
    // `max-width: 100%` keeps the wrapper inside `.cm-content` on mobile —
    // without it, a wide table's intrinsic min-content can push `.cm-content`
    // past the viewport, dragging headings/paragraphs along (same failure
    // mode as the code-block widget).
    maxWidth: '100%',
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
  },

  // ─── Inline images & placeholders ─────────────────────────────
  // Image widgets are emitted as inline replacements (no `block: true`),
  // so they live inside `.cm-line` flow. Margin must stay 0 — same height-map
  // rule as line/block decorations. Visual parity with `.image-placeholder`
  // in MarkdownPreview.svelte is intentional, but the layout adapts to the
  // inline context (inline-flex instead of block + text-align).
  '.cm-lp-img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '0.375em',
    verticalAlign: 'middle'
  },
  '.cm-lp-img-placeholder': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5em',
    padding: '0.4em 0.75em',
    margin: '0',
    border: '2px dashed var(--border)',
    borderRadius: '0.5em',
    background: 'var(--muted)',
    fontSize: '0.875rem',
    maxWidth: '100%',
    verticalAlign: 'middle'
  },
  '.cm-lp-img-placeholder--blocked': {
    borderColor: 'var(--destructive)',
    background: 'color-mix(in srgb, var(--destructive) 8%, var(--muted))'
  },
  '.cm-lp-img-placeholder-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    color: 'var(--muted-foreground)'
  },
  '.cm-lp-img-placeholder-url': {
    color: 'var(--muted-foreground)',
    wordBreak: 'break-all',
    flex: '1 1 auto',
    minWidth: '0'
  },
  '.cm-lp-img-placeholder-load': {
    padding: '0.25em 0.75em',
    borderRadius: '0.375em',
    background: 'var(--primary)',
    color: 'var(--primary-foreground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    flex: '0 0 auto'
  },
  '.cm-lp-img-placeholder-load:hover': {
    opacity: '0.9'
  }

  // Dark-mode token overrides live in NoteEditor.svelte's `<style>`
  // (`:global(.dark .cm-lp-codeblock .tok-*)`). They need a `.dark`
  // ancestor selector, which CM6 themes can't express — themes scope
  // every key under the editor root via a generated class.
});
