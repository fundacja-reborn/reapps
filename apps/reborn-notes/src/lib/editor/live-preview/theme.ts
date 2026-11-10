/**
 * CodeMirror theme for Live Preview mode.
 * Mirrors typography of MarkdownPreview.svelte so the editor and preview look alike.
 */
import { EditorView } from '@codemirror/view';

/**
 * A note-content font size: `rem` scaled by the note text size of this device
 * (`--rn-note-scale` on <html>, set from device prefs; 1 by default). Keep in
 * step with MarkdownPreview.svelte, which scales the same way. UI chrome inside
 * the editor (copy buttons, etc.) stays in plain `rem` = interface scale only.
 */
function noteRem(rem: number): string {
  return `calc(${rem}rem * var(--rn-note-scale, 1))`;
}

export const livePreviewTheme = EditorView.theme({
  // Use proportional Roboto in Live Preview so the view mirrors MarkdownPreview.
  // Markdown (raw) mode keeps the global monospace stack from app.css.
  '.cm-content': {
    fontFamily:
      "'Roboto', ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
  },

  // Headings - applied via Decoration.line on the heading line element.
  // NOTE: use padding (not margin) - CM6 measures `.cm-line` via
  // getBoundingClientRect() which excludes margins; vertical margins on lines
  // de-sync the height map and break posAtCoords (clicks land off-target).
  // The `& span { textDecoration: none }` overrides defaultHighlightStyle
  // which adds underline to tags.heading - Preview has no underline, so we
  // strip it here for visual parity.
  '.cm-lp-h1-line': {
    fontSize: noteRem(2),
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h2-line': {
    fontSize: noteRem(1.625),
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h3-line': {
    fontSize: noteRem(1.375),
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h4-line': {
    fontSize: noteRem(1.125),
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h5-line': {
    fontSize: noteRem(1),
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    '& span': { textDecoration: 'none' }
  },
  '.cm-lp-h6-line': {
    fontSize: noteRem(0.9375),
    fontWeight: '600',
    lineHeight: '1.3',
    paddingTop: '1.5em',
    paddingBottom: '0.5em',
    color: 'var(--muted-foreground)',
    '& span': { textDecoration: 'none' }
  },

  // Desktop heading sizes - match MarkdownPreview.svelte (md: 768px+).
  '@media (min-width: 768px)': {
    '.cm-lp-h1-line': { fontSize: noteRem(1.875) },
    '.cm-lp-h2-line': { fontSize: noteRem(1.5) },
    '.cm-lp-h3-line': { fontSize: noteRem(1.25) },
    '.cm-lp-h4-line': { fontSize: noteRem(1.0625) },
    '.cm-lp-h5-line': { fontSize: noteRem(0.9375) },
    '.cm-lp-h6-line': { fontSize: noteRem(0.875) }
  },

  // ─── Copy-link-to-heading button ─────────────────────────────
  // Emitted by `HeadingAnchorWidget` at the very end of each heading line, so it
  // flows inline right after the heading text - a short heading keeps the button
  // beside it instead of stranded at the far-right edge where it is easy to miss.
  // The box size is in `rem` (the SVG is a fixed 16px) so it stays consistent
  // across levels instead of scaling with the heading font. It keeps its box
  // while hidden (opacity, not display), so revealing it never reflows the text.
  '.cm-lp-head-anchor': {
    display: 'inline-flex',
    verticalAlign: 'middle',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.5rem',
    height: '1.5rem',
    marginInlineStart: '0.4em',
    padding: '0',
    border: '1px solid var(--border)',
    borderRadius: '0.375rem',
    background: 'var(--background)',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    opacity: '0',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease'
  },
  // Reveal on hover (desktop) or when the caret is on the heading line (the
  // `cm-lp-head-active` class - the only way to surface it on touch).
  '.cm-lp-h1-line:hover .cm-lp-head-anchor, .cm-lp-h2-line:hover .cm-lp-head-anchor, .cm-lp-h3-line:hover .cm-lp-head-anchor, .cm-lp-h4-line:hover .cm-lp-head-anchor, .cm-lp-h5-line:hover .cm-lp-head-anchor, .cm-lp-h6-line:hover .cm-lp-head-anchor':
    { opacity: '1' },
  '.cm-lp-head-active .cm-lp-head-anchor': { opacity: '1' },
  '.cm-lp-head-anchor:hover': { opacity: '1', color: 'var(--foreground)' },
  '.cm-lp-head-anchor:focus-visible': { opacity: '1', color: 'var(--foreground)' },

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

  // Link rendered by LinkWidget - clickable anchor
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

  // Blockquote - line-level border + indent
  '.cm-lp-blockquote-line': {
    borderInlineStart: '3px solid var(--border)',
    paddingInlineStart: '0.75em',
    color: 'var(--muted-foreground)',
    fontStyle: 'italic'
  },

  // Horizontal rule (thematic break) - the raw `---`/`***`/`___` is hidden by
  // a full-line replace, leaving an empty line we paint a centered divider on
  // via `::before`. Padding (not margin) gives vertical breathing room without
  // de-syncing the CM6 height map (same rule as headings). The 1px border
  // mirrors MarkdownPreview's <hr> (`border-top: 1px solid var(--border)`).
  '.cm-lp-hr-line': {
    position: 'relative',
    paddingTop: '0.75em',
    paddingBottom: '0.75em'
  },
  '.cm-lp-hr-line::before': {
    content: '""',
    position: 'absolute',
    insetInlineStart: '0',
    insetInlineEnd: '0',
    top: '50%',
    borderTop: '1px solid var(--border)',
    // Pseudo-element must not swallow clicks - the caret needs to land on the
    // line to switch back to the raw, editable `---`.
    pointerEvents: 'none'
  },

  // Bullet list - depth-aware padding + ::before bullet.
  //
  // Tapered ramp (mirrored in MarkdownPreview.svelte's `[data-d{N}]` rules,
  // with one deliberate exception: Preview renders first-level ol at 2em so
  // Safari doesn't clip 2-digit ::marker numbers at the scroll-container
  // edge - see the ol[data-d='1'] comment there. Here the number is source
  // text, never a marker, so 1.5em stays safe):
  //   d1 → 1.5em (preserves the historical first-level indent)
  //   d2 → 4em   (krok +2.5em - a noticeable visual step so a nested item
  //               doesn't sit in the same column as the parent's content)
  //   d3..d6 → +1.5em per level (5.5, 7, 8.5, 10)
  //   d7..d12 → +0.75em per level (10.75, 11.5, 12.25, 13, 13.75, 14.5)
  //   clamp at d12 ≈ 14.5em (~232px on a 360px viewport - usable on mobile,
  //   deeper trees are vanishingly rare in real notes)
  //
  // Each ListItem gets `cm-lp-bullet-line cm-lp-bullet-d{N}` from
  // `decorations.ts` (N = BulletList/OrderedList ancestor count, clamped to
  // MAX_LIST_DEPTH). The bullet `::before` sits 1em before the content
  // (inline-start side), giving every level the same marker-to-text
  // relationship while the contents shift towards inline-end as nesting
  // deepens. Logical properties: each line carries `dir="auto"` (bidi.ts), so
  // an RTL list item mirrors the ramp and the bullet automatically.
  '.cm-lp-bullet-line': {
    position: 'relative'
  },
  '.cm-lp-bullet-line::before': {
    content: '"•"',
    position: 'absolute',
    color: 'var(--muted-foreground)'
  },
  '.cm-lp-bullet-d1': { paddingInlineStart: '1.5em' },
  '.cm-lp-bullet-d1::before': { insetInlineStart: '0.5em' },
  '.cm-lp-bullet-d2': { paddingInlineStart: '4em' },
  '.cm-lp-bullet-d2::before': { insetInlineStart: '3em' },
  '.cm-lp-bullet-d3': { paddingInlineStart: '5.5em' },
  '.cm-lp-bullet-d3::before': { insetInlineStart: '4.5em' },
  '.cm-lp-bullet-d4': { paddingInlineStart: '7em' },
  '.cm-lp-bullet-d4::before': { insetInlineStart: '6em' },
  '.cm-lp-bullet-d5': { paddingInlineStart: '8.5em' },
  '.cm-lp-bullet-d5::before': { insetInlineStart: '7.5em' },
  '.cm-lp-bullet-d6': { paddingInlineStart: '10em' },
  '.cm-lp-bullet-d6::before': { insetInlineStart: '9em' },
  '.cm-lp-bullet-d7': { paddingInlineStart: '10.75em' },
  '.cm-lp-bullet-d7::before': { insetInlineStart: '9.75em' },
  '.cm-lp-bullet-d8': { paddingInlineStart: '11.5em' },
  '.cm-lp-bullet-d8::before': { insetInlineStart: '10.5em' },
  '.cm-lp-bullet-d9': { paddingInlineStart: '12.25em' },
  '.cm-lp-bullet-d9::before': { insetInlineStart: '11.25em' },
  '.cm-lp-bullet-d10': { paddingInlineStart: '13em' },
  '.cm-lp-bullet-d10::before': { insetInlineStart: '12em' },
  '.cm-lp-bullet-d11': { paddingInlineStart: '13.75em' },
  '.cm-lp-bullet-d11::before': { insetInlineStart: '12.75em' },
  '.cm-lp-bullet-d12': { paddingInlineStart: '14.5em' },
  '.cm-lp-bullet-d12::before': { insetInlineStart: '13.5em' },

  // Ordered list - same indent rhythm but no ::before (number stays in source).
  '.cm-lp-ordered-line': {},
  '.cm-lp-ordered-d1': { paddingInlineStart: '1.5em' },
  '.cm-lp-ordered-d2': { paddingInlineStart: '4em' },
  '.cm-lp-ordered-d3': { paddingInlineStart: '5.5em' },
  '.cm-lp-ordered-d4': { paddingInlineStart: '7em' },
  '.cm-lp-ordered-d5': { paddingInlineStart: '8.5em' },
  '.cm-lp-ordered-d6': { paddingInlineStart: '10em' },
  '.cm-lp-ordered-d7': { paddingInlineStart: '10.75em' },
  '.cm-lp-ordered-d8': { paddingInlineStart: '11.5em' },
  '.cm-lp-ordered-d9': { paddingInlineStart: '12.25em' },
  '.cm-lp-ordered-d10': { paddingInlineStart: '13em' },
  '.cm-lp-ordered-d11': { paddingInlineStart: '13.75em' },
  '.cm-lp-ordered-d12': { paddingInlineStart: '14.5em' },

  // ─── GFM task list (- [ ] / - [x]) ───────────────────────────
  // Same depth ramp as bullets so mixed bullet/task siblings line up. No
  // `::before` content - the `TaskCheckboxWidget` <input> sits in the marker
  // zone instead. Completed lines (`[x]`) get an extra `cm-lp-task-checked`
  // for strikethrough + muted color.
  '.cm-lp-task-line': {
    position: 'relative'
  },
  '.cm-lp-task-d1': { paddingInlineStart: '1.5em' },
  '.cm-lp-task-d2': { paddingInlineStart: '4em' },
  '.cm-lp-task-d3': { paddingInlineStart: '5.5em' },
  '.cm-lp-task-d4': { paddingInlineStart: '7em' },
  '.cm-lp-task-d5': { paddingInlineStart: '8.5em' },
  '.cm-lp-task-d6': { paddingInlineStart: '10em' },
  '.cm-lp-task-d7': { paddingInlineStart: '10.75em' },
  '.cm-lp-task-d8': { paddingInlineStart: '11.5em' },
  '.cm-lp-task-d9': { paddingInlineStart: '12.25em' },
  '.cm-lp-task-d10': { paddingInlineStart: '13em' },
  '.cm-lp-task-d11': { paddingInlineStart: '13.75em' },
  '.cm-lp-task-d12': { paddingInlineStart: '14.5em' },
  '.cm-lp-task-checked': {
    textDecoration: 'line-through',
    color: 'var(--muted-foreground)',
    opacity: '0.7'
  },
  '.cm-lp-task-checkbox': {
    marginInlineEnd: '0.4em',
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
  // Margin must stay 0 - same height-map rule as line decorations.
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

  // Copy button - pinned to the block's top-right, over the <pre>. Colours use
  // app CSS vars so the button tracks light/dark via the cascade (the CM6
  // theme stylesheet can't target `.dark` on <html> directly).
  '.cm-lp-code-copy': {
    position: 'absolute',
    top: '0.4em',
    insetInlineEnd: '0.4em',
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

  // ─── In-note table of contents ───────────────────────────────
  // Cursor outside: the managed block is replaced with a boxed <nav> + corner
  // toolbar - mirrors `.note-toc` in MarkdownPreview.svelte (keep in sync) and
  // the copy-button precedent above. Margin must stay 0 (CM6 height-map rule for
  // block widgets); the markdown's surrounding blank lines provide the spacing.
  '.cm-lp-toc': {
    position: 'relative',
    margin: '0',
    padding: '0.75em 1em',
    border: '1px solid var(--border)',
    borderRadius: '0.5em',
    background: 'color-mix(in srgb, var(--muted) 40%, transparent)',
    // The editor uses `white-space: pre-wrap` (lineWrapping), under which the
    // newlines marked emits BETWEEN tags (`</li>\n<li>`) render as real line
    // breaks - blowing the list apart. The TOC is prose-like HTML, not source,
    // so reset to normal whitespace collapsing (inherited by all entries) to
    // match the rendered preview's compact spacing.
    whiteSpace: 'normal'
  },
  '.cm-lp-toc p': { margin: '0 0 0.5em', fontSize: '0.9375em' },
  '.cm-lp-toc ul': { margin: '0 0 0 1.1em', padding: '0', listStyle: 'none' },
  '.cm-lp-toc ul ul': { marginBottom: '0' },
  '.cm-lp-toc li + li': { marginTop: '0.15em' },
  '.cm-lp-toc a': {
    color: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer'
  },
  '.cm-lp-toc a:hover': { color: 'var(--primary)' },
  // Corner toolbar - hidden until hover/focus; force-shown when out of date so
  // the drift is noticed (a child can't out-opaque its parent, so the reveal
  // lives on the actions wrapper - same `:has()` trick as the preview).
  '.cm-lp-toc-actions': {
    position: 'absolute',
    top: '0.4em',
    insetInlineEnd: '0.4em',
    zIndex: '1',
    display: 'inline-flex',
    gap: '0.25em',
    opacity: '0',
    transition: 'opacity 0.12s ease'
  },
  '.cm-lp-toc:hover .cm-lp-toc-actions': { opacity: '1' },
  '.cm-lp-toc:focus-within .cm-lp-toc-actions': { opacity: '1' },
  '.cm-lp-toc:has(.cm-lp-toc-refresh.is-stale) .cm-lp-toc-actions': { opacity: '1' },
  '.cm-lp-toc-btn': {
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
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'color 0.12s ease, border-color 0.12s ease, background 0.12s ease'
  },
  '.cm-lp-toc-btn:hover': { color: 'var(--foreground)', background: 'var(--accent)' },
  '.cm-lp-toc-btn:focus-visible': { color: 'var(--foreground)', background: 'var(--accent)' },
  '.cm-lp-toc-remove:hover': { color: 'var(--destructive)', borderColor: 'var(--destructive)' },
  // Out of date: refresh button stays visible + amber so the drift is noticed.
  '.cm-lp-toc-refresh.is-stale': { color: '#d97706', borderColor: '#d97706' },

  // Cursor inside: raw markdown reveal keeps the box background per-line (like the
  // fenced-code-block reveal) so the block stays distinct instead of blending into
  // the note. Padding-only (no margin) - CM6 height-map rule. Background matches
  // the `.cm-lp-toc` widget so click-to-edit doesn't change the block's colour.
  '.cm-lp-toc-line': {
    backgroundColor: 'color-mix(in srgb, var(--muted) 40%, transparent)',
    paddingInlineStart: '1em',
    paddingInlineEnd: '1em'
  },
  '.cm-lp-toc-line-first': {
    paddingTop: '0.5em',
    borderStartStartRadius: '0.5em',
    borderStartEndRadius: '0.5em'
  },
  '.cm-lp-toc-line-last': {
    paddingBottom: '0.5em',
    borderEndStartRadius: '0.5em',
    borderEndEndRadius: '0.5em'
  },

  // Cursor inside: per-line decoration so the raw fences and body share
  // a continuous code-block look. Padding-only (no margin) - see header
  // note about CM6 height map.
  '.cm-lp-code-line': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.875em',
    backgroundColor: 'var(--muted)',
    paddingInlineStart: '1em',
    paddingInlineEnd: '1em'
  },
  '.cm-lp-code-line-first': {
    paddingTop: '0.5em',
    borderStartStartRadius: '0.5em',
    borderStartEndRadius: '0.5em'
  },
  '.cm-lp-code-line-last': {
    paddingBottom: '0.5em',
    borderEndStartRadius: '0.5em',
    borderEndEndRadius: '0.5em'
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
  // Block-replace widget. Margin must stay 0 - same height-map rule
  // as fenced code blocks. Padding lives on the wrapper instead.
  '.cm-lp-table-wrap': {
    margin: '0',
    padding: '0.25em 0',
    // `max-width: 100%` keeps the wrapper inside `.cm-content` on mobile -
    // without it, a wide table's intrinsic min-content can push `.cm-content`
    // past the viewport, dragging headings/paragraphs along (same failure
    // mode as the code-block widget).
    maxWidth: '100%',
    overflowX: 'auto'
  },
  '.cm-lp-table': {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: noteRem(0.9375),
    tableLayout: 'auto'
  },
  '.cm-lp-table th, .cm-lp-table td': {
    padding: '0.5em 0.75em',
    border: '1px solid var(--border)',
    textAlign: 'start',
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
  // Active-column tint, shown while the column bar is visible so alignment /
  // insert-column / delete-column read as column-scoped (GFM alignment is
  // per-column, never per-cell). Specificity (0,2,0) sits above the base th
  // `--muted` background (0,1,1) but below `:focus` (0,2,1), so the focused cell
  // keeps its stronger ring + tint.
  '.cm-lp-table .cm-lp-col-active': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 6%, transparent)'
  },

  // ─── Table structural mini-toolbar (Obsidian-style) ───────────
  // The outer is a non-clipping positioning context for the two floating bars.
  // The inner `.cm-lp-table-wrap` keeps `overflow-x: auto` (which CSS promotes
  // to clipping on both axes), so the bars must live in the outer to be able to
  // sit above / to the left of the table. All colours use design-system vars,
  // so light/dark adapt without a `.dark` override.
  '.cm-lp-table-outer': {
    position: 'relative',
    margin: '0'
  },
  '.cm-lp-table-colbar, .cm-lp-table-rowbar': {
    position: 'absolute',
    zIndex: '5',
    display: 'none', // toggled to `flex` + positioned in JS (syncToolbars)
    gap: '1px',
    padding: '2px',
    background: 'var(--popover, var(--background))',
    color: 'var(--popover-foreground, var(--foreground))',
    border: '1px solid var(--border)',
    borderRadius: '0.45em',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)'
  },
  '.cm-lp-table-colbar': { flexDirection: 'row', alignItems: 'center' },
  '.cm-lp-table-rowbar': { flexDirection: 'column', alignItems: 'center' },
  '.cm-lp-table-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.65em',
    height: '1.65em',
    padding: '0',
    border: 'none',
    borderRadius: '0.3em',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    lineHeight: '1'
  },
  '.cm-lp-table-btn:hover': {
    background: 'var(--accent)',
    color: 'var(--accent-foreground)'
  },
  '.cm-lp-table-btn.is-active': {
    background: 'var(--primary)',
    color: 'var(--primary-foreground)'
  },
  '.cm-lp-table-btn.is-danger:hover': {
    background: 'var(--destructive)',
    color: 'var(--destructive-foreground)'
  },
  '.cm-lp-table-btn[disabled]': {
    opacity: '0.35',
    cursor: 'default'
  },
  '.cm-lp-table-btn[disabled]:hover': {
    background: 'transparent',
    color: 'inherit'
  },
  '.cm-lp-table-btn svg': {
    width: '1em',
    height: '1em',
    display: 'block'
  },
  '.cm-lp-table-sep': {
    background: 'var(--border)',
    flex: '0 0 auto'
  },
  '.cm-lp-table-colbar .cm-lp-table-sep': { width: '1px', height: '1.1em', margin: '0 1px' },
  '.cm-lp-table-rowbar .cm-lp-table-sep': { height: '1px', width: '1.1em', margin: '1px 0' },

  // ─── Inline images & placeholders ─────────────────────────────
  // Image widgets are emitted as inline replacements (no `block: true`),
  // so they live inside `.cm-line` flow. Margin must stay 0 - same height-map
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
    fontSize: noteRem(0.875),
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
    fontSize: noteRem(0.8125),
    flex: '0 0 auto'
  },
  '.cm-lp-img-placeholder-load:hover': {
    opacity: '0.9'
  }

  // Dark-mode token overrides live in NoteEditor.svelte's `<style>`
  // (`:global(.dark .cm-lp-codeblock .tok-*)`). They need a `.dark`
  // ancestor selector, which CM6 themes can't express - themes scope
  // every key under the editor root via a generated class.
});
