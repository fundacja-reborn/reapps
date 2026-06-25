<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Marked, type Tokens, type RendererObject } from 'marked';
  import DOMPurify from 'dompurify';

  import { t } from '$lib/stores/i18n.store';
  import type { ImageLoadMode } from '@reborn/storage';
  import {
    highlightCodeToHtml,
    triggerLanguageLoad,
    CODE_COPY_ICON,
    copyCodeFromButton,
    HEADING_LINK_ICON
  } from '$lib/editor/live-preview';
  import {
    annotateTopLevelLines,
    applySourceLineAttrs
  } from '$lib/utils/source-line';
  import {
    createMarkdownListRenderers,
    createMarkdownImageRenderer
  } from '$lib/utils/markdown-to-html';
  import { extractHeadings, assignHeadingSlugs } from '$lib/utils/heading-outline';
  import { scrollToHeading } from '$lib/utils/heading-scroll';
  import { hasToc, tocInnerMarkdown, toEditableTocBlock } from '$lib/utils/toc';

  // Toolbar icons for the owner's in-note table of contents (refresh + remove).
  // Static, self-contained Lucide-style SVGs (16px, `stroke="currentColor"` so
  // they follow the button colour) - same approach as CODE_COPY_ICON, never user
  // input, so DOMPurify's svg profile passes them through unchanged.
  const TOC_REFRESH_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  const TOC_REMOVE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

  // `note:UUID` with an optional `#heading-slug` anchor. Group 1 = UUID,
  // group 2 = anchor (without the `#`), undefined when there is none.
  const NOTE_LINK_RE =
    /^note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#(.+))?$/i;

  const ALLOWED_URI =
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|note):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i; // eslint-disable-line no-useless-escape

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (NOTE_LINK_RE.test(href)) {
        node.setAttribute('data-note-link', 'true');
      }
    }
  });

  function sanitize(html: string): string {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true },
      ALLOWED_URI_REGEXP: ALLOWED_URI
    });
  }

  let {
    content = '',
    class: className = '',
    // eslint-disable-next-line no-useless-assignment -- $bindable prop default (set by parent via bind:), not dead
    scrollEl = $bindable<HTMLElement | null>(null),
    // eslint-disable-next-line no-useless-assignment -- $bindable prop default (set by parent via bind:), not dead
    contentEl = $bindable<HTMLElement | null>(null),
    imageLoadMode = 'ask' as ImageLoadMode,
    loadAllImagesHint,
    settingsLinkLabel,
    settingsLinkHref,
    onNoteLink,
    onTaskToggle,
    onTocRefresh,
    onTocDelete,
    tocStale = false,
    onrender,
    onHeadingLinkCopy,
    headingLinkLabel
  }: {
    content: string;
    class?: string;
    scrollEl?: HTMLElement | null;
    /**
     * The element that holds the rendered HTML and the `data-source-line`
     * markers. Same as `scrollEl` when this component owns its scroll
     * (split view); different when the parent scrolls (desktop single-pane
     * with `parentScroll=true`).
     */
    contentEl?: HTMLElement | null;
    imageLoadMode?: ImageLoadMode;
    /**
     * Optional plain-text caption rendered next to the "Load all images"
     * button. Used by the shared-snapshot viewer to explain to non-technical
     * recipients why external images don't load automatically, and by the
     * owner-side preview to point at the appearance setting that controls
     * the default behaviour.
     */
    loadAllImagesHint?: string;
    /**
     * Optional CTA appended to `loadAllImagesHint` as an inline anchor.
     * Used by the owner-side preview to deep-link into the image-loading
     * preference in /settings/appearance. Both label and href must be set
     * for the link to render. Snapshot viewer leaves these unset.
     */
    settingsLinkLabel?: string;
    settingsLinkHref?: string;
    /**
     * Called when the user clicks a `note:UUID` link. `anchor` is the optional
     * `#heading-slug` (without the `#`) when the link targets a heading
     * (`note:UUID#slug`); the owner navigates to the note and scrolls to it.
     */
    onNoteLink?: (noteId: string, anchor?: string) => void;
    /**
     * Called when the user clicks a checkbox in a GFM task list. The owner
     * is responsible for toggling the matching `[ ]` / `[x]` in the
     * markdown source — this component only emits the click, since the
     * source string lives upstream (note store / editor doc).
     *
     * `taskIndex` is the zero-based ordinal of the task in render order
     * (mirrored on the editor side by counting `[ ]`/`[x]` markers in the
     * doc), `checked` is the new desired state.
     */
    onTaskToggle?: (taskIndex: number, checked: boolean) => void;
    /**
     * Owner-only table-of-contents toolbar. When `onTocRefresh` is provided AND
     * the note holds a managed TOC block, the block is rendered as a single
     * `<nav class="note-toc">` carrying a refresh + remove toolbar (mirrors the
     * code-block copy button). Both callbacks mutate the markdown source upstream
     * (like {@link onTaskToggle}). Read-only viewers (shared snapshot, history)
     * leave these unset, so the markers there are just stripped to a plain
     * bold-title + list with no controls.
     */
    onTocRefresh?: () => void;
    onTocDelete?: () => void;
    /** Drives the "out of date" styling on the refresh button (headings drifted). */
    tocStale?: boolean;
    /**
     * Fired after the rendered HTML is committed to the DOM (and
     * `data-source-line` attrs are stamped). The parent uses this to
     * rebuild line-anchor caches in the scroll-sync.
     */
    onrender?: () => void;
    /**
     * Owner-editable preview only. When provided, each rendered heading gets a
     * hover-revealed "copy link to heading" button; the click reports the
     * heading's slug + text so the owner builds + copies the internal link (it
     * holds the note id, clipboard helper and toast). Read-only viewers (shared
     * snapshot, history) leave it unset, so no button is injected there.
     */
    onHeadingLinkCopy?: (slug: string, text: string) => void;
    /** aria-label / tooltip for the per-heading copy-link button. */
    headingLinkLabel?: string;
  } = $props();

  let containerEl: HTMLElement;

  // Async-load tick — bumped each time a fenced-code language chunk finishes
  // loading, so the `$derived html` recomputes and replaces the plaintext
  // fallback with a syntax-highlighted version. Mirrors the editor's
  // `rebuildLivePreview` effect, but on the Svelte side.
  let langLoadTick = $state(0);

  onMount(() => {
    scrollEl = containerEl;
    contentEl = containerEl;
    // Clear bindings on unmount so the parent's preview adapter detaches —
    // otherwise a toggle to edit-only would leave a stale (detached)
    // adapter live, eating editor scroll events via `syncing`.
    return () => {
      scrollEl = null;
      contentEl = null;
    };
  });

  // Per-instance marked: avoids the global `marked.use` singleton being
  // stomped when multiple MarkdownPreview components are mounted (e.g. mobile
  // + desktop layouts, or version-history previews).
  const md = new Marked({ gfm: true, breaks: true });

  // Separate, vanilla Marked for rendering the TOC block's inner title + list to
  // HTML before it is spliced into the atomic `<nav>` (see toEditableTocBlock).
  // Kept distinct from `md` so it never touches `md`'s per-render list/task
  // counters, and so the TOC list renders with default markup we style under
  // `.note-toc` rather than the data-d list ramp used for body lists.
  const tocMd = new Marked({ gfm: true, breaks: true });

  // The owner-only refresh + remove toolbar, injected just inside the TOC `<nav>`.
  // Labels are attribute-escaped; the refresh button doubles as the "out of date"
  // indicator via `is-stale`. Built in the html derivation so it tracks locale
  // and `tocStale`.
  function buildTocToolbar(): string {
    const esc = (s: string) => s.replace(/"/g, '&quot;');
    const refreshLabel = esc(tocStale ? $t('toc.stale') : $t('toc.refresh'));
    const removeLabel = esc($t('toc.remove'));
    const staleCls = tocStale ? ' is-stale' : '';
    return (
      '<span class="note-toc-actions">' +
      `<button type="button" class="note-toc-btn note-toc-refresh${staleCls}" aria-label="${refreshLabel}" title="${refreshLabel}">${TOC_REFRESH_ICON}</button>` +
      `<button type="button" class="note-toc-btn note-toc-remove" aria-label="${removeLabel}" title="${removeLabel}">${TOC_REMOVE_ICON}</button>` +
      '</span>'
    );
  }

  // List / task-list renderers are shared with `exportNoteAsPdf` so the PDF
  // pipeline emits the same `task-list-item` markup (no double bullet, scoped
  // strikethrough). Image / code below stay Preview-specific.
  const { renderer: listRenderers, reset: resetListCounters } =
    createMarkdownListRenderers();
  const renderer: RendererObject = { ...listRenderers };

  // Image renderer lives in markdown-to-html.ts so its mode/placeholder logic is
  // unit-tested without mounting this component (markdown-to-html.spec.ts). It
  // owns `askPlaceholderCount` — the structural count of ask-mode Load buttons
  // emitted, which gates the "Load all images" banner. Two reasons the mode is
  // pushed in via setImageMode() rather than the renderer closing over the
  // reactive `imageLoadMode` prop directly:
  //   1. A Svelte 5 prop read at script init captures only the initial value,
  //      not the reactive binding (svelte-check warns about this); the renderer
  //      is built once at init, so a direct closure would freeze to 'ask'.
  //   2. marked calls renderImage from a third-party call stack with no reactive
  //      context, so there's nothing for Svelte to attach a lazy read to anyway.
  // `(key) => $t(key)` resolves labels at render time so they follow locale —
  // same call-time `$t` resolution the previous inline closure used.
  const {
    renderImage,
    setMode: setImageMode,
    reset: resetImageRenderer,
    getAskPlaceholderCount
  } = createMarkdownImageRenderer((key) => $t(key));
  renderer.image = renderImage;

  // Fenced code blocks — share the highlight pipeline with Live Preview's
  // CodeBlockWidget (`highlightCodeToHtml`). Output is escaped text + safe
  // `<span class="tok-...">` wrappers — DOMPurify passes these through
  // (`USE_PROFILES.html` allows `class` on `<span>`).
  // If the language chunk hasn't loaded yet, the helper renders plaintext
  // and we kick off the async load — once it resolves we bump `langLoadTick`
  // so the `$derived html` re-runs with the highlighted version.
  renderer.code = ({ text, lang }: Tokens.Code) => {
    const info = (lang ?? '').trim();
    if (info) {
      void triggerLanguageLoad(info).then((loaded) => {
        if (loaded) langLoadTick++;
      });
    }
    // Wrap the <pre> in a positioned container holding a top-right copy
    // button. `.code-block` (not the scrollable <pre>) is the positioning
    // context so the button stays pinned while wide code scrolls under it.
    // The button lives in the sanitized {@html}; clicks are handled by
    // delegation in `handleClick`. The label is escaped for the attribute.
    const copyLabel = $t('editor.code_copy').replace(/"/g, '&quot;');
    const pre = highlightCodeToHtml(text, info);
    return `<div class="code-block"><button class="code-copy-btn" type="button" aria-label="${copyLabel}" title="${copyLabel}">${CODE_COPY_ICON}</button>${pre}</div>`;
  };

  md.use({ renderer });

  // Tokens of the latest render — kept so we can stamp `data-source-line`
  // on the matching DOM children after `{@html}` commits the new HTML.
  let lastTokens: import('marked').Token[] = [];

  const html = $derived.by(() => {
    // Reactive deps:
    //  - `langLoadTick` re-runs the derivation when a fenced-code language
    //    chunk has loaded so plaintext fallbacks get replaced with
    //    highlighted spans.
    //  - `imageLoadMode` is read explicitly by passing it to setImageMode().
    //    The call can't be DCE'd, guaranteeing the prop is tracked as a dep
    //    even if the compiler ever optimises plain reads, and pushes the mode
    //    into the renderer (which runs from marked's non-reactive call stack).
    void langLoadTick;
    setImageMode(imageLoadMode);
    // Reset before parse — renderImage re-increments askPlaceholderCount for
    // each ask-mode external image it emits during md.parser() below.
    resetImageRenderer();
    // Defensive reset — renderer.list decrements after each list, so under
    // normal flow listDepth is already 0; resetting guards against a thrown
    // sanitize/parse leaving the counters stuck, and starts taskCounter at 0
    // so `data-task-index` aligns with the markdown source's marker order.
    resetListCounters();
    if (!content) {
      lastTokens = [];
      return '';
    }
    // Owner-editable preview: render a managed TOC block as one atomic <nav>
    // (one token -> one DOM node) carrying the refresh/remove toolbar, so the
    // source-line zip and split-view scroll-sync stay aligned. Read-only viewers
    // (no onTocRefresh) skip this; their markers are stripped to a plain list.
    let source = content;
    if (onTocRefresh && hasToc(content)) {
      const innerMd = tocInnerMarkdown(content);
      const innerHtml = innerMd != null ? (tocMd.parse(innerMd) as string) : '';
      source = toEditableTocBlock(content, innerHtml, buildTocToolbar());
    }
    const tokens = md.lexer(source);
    annotateTopLevelLines(tokens);
    lastTokens = tokens;
    const raw = sanitize(md.parser(tokens) as string);
    // Wrap each rendered table in a horizontally-scrollable container so wide
    // tables (long unbreakable identifiers like `MAX_ENCRYPTED_FOO_BYTES`)
    // get their own scrollbar next to the table itself, instead of forcing
    // horizontal scroll on the entire preview where the scrollbar lands at
    // the bottom of the whole note - far from the offending row. Mirrors the
    // <pre> overflow-x:auto pattern. marked's GFM output emits a bare
    // `<table>` with no attributes, so a literal replace is safe.
    const tableWrapped = raw
      .replace(/<table>/g, '<div class="table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>');
    // Note links render with their authored label, exactly as written - same as
    // Live Preview, the shared snapshot and exported Markdown. We deliberately do
    // NOT swap the label for the target note's current title: that clobbered
    // custom labels and heading-anchor link text (`[localhost](note:UUID#slug)`
    // showed the note title instead). The authored label is the source of truth.
    return tableWrapped;
  });

  // After {@html html} commits to the DOM, stamp top-level children with
  // `data-source-line="N"` and let the parent rebuild scroll-sync anchors.
  // We also re-fire `onrender` once any lazily-loading <img> finishes —
  // image heights only show up post-load, and the parent's anchor cache
  // would otherwise be stale by tens of pixels for the rest of the doc.
  $effect(() => {
    void html;
    if (!containerEl) return;
    applySourceLineAttrs(containerEl, lastTokens);
    assignHeadingIds(containerEl, content);
    // `onrender` is a post-render notification, not a reactive read. The owner's
    // callback may read-modify-write its own state (the Outline scroll-spy bumps
    // a render tick: `previewRenderTick++`). Run it untracked so that read does
    // NOT make this render effect depend on the owner's tick - otherwise the
    // write re-triggers this very effect on every render, looping until Svelte
    // throws effect_update_depth_exceeded. The deps that SHOULD re-run this
    // effect (`html`, `content`, `containerEl`) are all read above, untouched.
    untrack(() => onrender?.());

    const images = containerEl.querySelectorAll('img');
    const onLoad = () => onrender?.();
    images.forEach((img) => {
      if (!img.complete) img.addEventListener('load', onLoad, { once: true });
    });
    return () => images.forEach((img) => img.removeEventListener('load', onLoad));
  });

  function loadImage(placeholder: HTMLElement) {
    const src = placeholder.dataset.src!;
    const alt = placeholder.dataset.alt || '';
    const title = placeholder.dataset.title || '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    if (title) img.title = title;
    img.loading = 'lazy';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '0.375em';
    placeholder.replaceWith(img);
  }

  // Stamp slug ids on rendered headings so in-note `#anchor` links, cross-note
  // `note:UUID#anchor` links and the outline panel can scroll to them. Ids come
  // from extractHeadings(content) - the SAME source the outline panel and the
  // import link-rewrite use - so a TOC link's `#slug` always matches the
  // heading's id. If marked and our extractor disagree on the heading count
  // (e.g. a Setext heading we deliberately don't parse), fall back to slugifying
  // each rendered heading's text so ids are still present and unique for in-note
  // navigation within this preview.
  function assignHeadingIds(root: HTMLElement, source: string) {
    const headings = root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
    const slugs = extractHeadings(source).map((h) => h.slug);
    const ids =
      slugs.length === headings.length
        ? slugs
        : assignHeadingSlugs([...headings].map((el) => el.textContent ?? ''));
    const anchorLabel = headingLinkLabel ?? '';
    headings.forEach((el, i) => {
      el.id = ids[i];
      // Owner-editable preview: append the hover-revealed copy-link button. The
      // heading is rebuilt on every {@html} commit, so it never accumulates.
      // Read the text BEFORE appending so the label is the heading content, not
      // the button glyph. The click is handled by delegation in `handleClick`;
      // the icon is a trusted constant (never user input), like CODE_COPY_ICON.
      if (onHeadingLinkCopy) {
        const text = el.textContent ?? '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-head-anchor';
        btn.title = anchorLabel;
        btn.setAttribute('aria-label', anchorLabel);
        btn.dataset.headingSlug = ids[i];
        btn.dataset.headingText = text;
        btn.innerHTML = HEADING_LINK_ICON;
        el.appendChild(btn);
      }
    });
  }

  function handleClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Copy-code button (top-right of each fenced block). `closest` resolves
    // clicks that land on the inner <svg>/<path>. We read the rendered code
    // back from the <code> textContent and strip the single synthetic trailing
    // newline added for last-line selection, so the clipboard gets the
    // original source.
    const copyBtn = target.closest('.code-copy-btn');
    if (copyBtn) {
      e.preventDefault();
      const codeEl = copyBtn.closest('.code-block')?.querySelector('pre code');
      const code = (codeEl?.textContent ?? '').replace(/\n$/, '');
      void copyCodeFromButton(copyBtn as HTMLElement, code, {
        copy: $t('editor.code_copy'),
        copied: $t('editor.code_copied')
      });
      return;
    }

    // Copy-link-to-heading button (owner preview). Inert DOM carrying the
    // heading's slug + text; the owner builds + copies the internal link and
    // shows the toast (it holds the note id). `closest` resolves clicks on the
    // inner <svg>/<path>.
    const headBtn = target.closest('.md-head-anchor');
    if (headBtn) {
      e.preventDefault();
      const slug = (headBtn as HTMLElement).dataset.headingSlug ?? '';
      if (slug) onHeadingLinkCopy?.(slug, (headBtn as HTMLElement).dataset.headingText ?? '');
      return;
    }

    // Task list checkbox toggle. The browser flips `checked` before the
    // click handler runs; we read the flipped value as the desired state and
    // ask the owner to persist it in the markdown source. The next render
    // outputs a fresh checkbox with the correct `checked` attribute, so the
    // visual stays in sync. If no callback is wired (read-only context), we
    // `preventDefault` to revert the flip so the DOM doesn't drift from the
    // source.
    if (target.tagName === 'INPUT' && target.classList.contains('task-list-item-checkbox')) {
      const li = target.closest('li.task-list-item') as HTMLElement | null;
      const idxAttr = li?.dataset.taskIndex;
      const idx = idxAttr != null ? parseInt(idxAttr, 10) : NaN;
      if (!Number.isFinite(idx) || !onTaskToggle) {
        e.preventDefault();
        return;
      }
      const desired = (target as HTMLInputElement).checked;
      onTaskToggle(idx, desired);
      return;
    }

    // Handle "Load image" button
    const loadBtn = target.closest('.image-placeholder-load');
    if (loadBtn) {
      e.preventDefault();
      const placeholder = loadBtn.closest('.image-placeholder') as HTMLElement;
      if (placeholder) loadImage(placeholder);
      return;
    }

    // Handle "Load all images" button - remove the whole row (button + optional
    // privacy hint) so the hint doesn't linger after images are loaded.
    if (target.closest('.load-all-images-btn')) {
      e.preventDefault();
      const placeholders = containerEl.querySelectorAll('.image-placeholder');
      placeholders.forEach((p) => loadImage(p as HTMLElement));
      target.closest('.load-all-images-row')?.remove();
      return;
    }

    // In-note TOC toolbar (owner-editable preview only): refresh / remove the
    // managed block. Handlers mutate the markdown source upstream.
    const tocBtn = target.closest('.note-toc-refresh, .note-toc-remove');
    if (tocBtn) {
      e.preventDefault();
      if (tocBtn.classList.contains('note-toc-refresh')) onTocRefresh?.();
      else onTocDelete?.();
      return;
    }

    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href') || '';
    const noteMatch = href.match(NOTE_LINK_RE);

    if (noteMatch) {
      e.preventDefault();
      // noteMatch[2] is the optional #heading anchor (without the `#`), or
      // undefined. The owner navigates to the note and scrolls to the heading.
      onNoteLink?.(noteMatch[1], noteMatch[2]);
      return;
    }

    // In-note heading anchor (`[Section](#slug)`, e.g. a table of contents):
    // scroll within this preview rather than let the browser navigate the URL
    // hash (which would clash with share deep-links and SPA routing).
    if (href.startsWith('#')) {
      e.preventDefault();
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* malformed %-escape - fall back to the raw fragment */
      }
      scrollToHeading(containerEl, id);
      return;
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  // Show the "Load all images" button only when the render actually emitted
  // per-image Load buttons. `renderImage` increments its placeholder counter
  // exactly once per ask-mode external image, and marked never calls it for
  // image syntax inside inline code or fenced blocks — so the count mirrors
  // what is shown beneath the banner. Reading `html` registers the parse as a
  // dependency and forces it to run first, populating the counter before we
  // read it. We deliberately do NOT scan the rendered HTML for the placeholder
  // class: a note can put that literal string into its own text (e.g. a note
  // documenting this very class), which a substring check false-positives on;
  // a counter driven by the renderer cannot be spoofed by content.
  const hasImagePlaceholders = $derived.by(() => {
    void html;
    return getAskPlaceholderCount() > 0;
  });
</script>

<!-- `data-sveltekit-preload-*="off"` stops SvelteKit's hover/touch preload
     for any <a> emitted by the rendered markdown. Preview links are user
     content (relative paths, external URLs, `note:UUID`) — none of them are
     real SvelteKit routes, so the preload chunks are always wasted. Without
     this, every {@html} re-render (e.g. checkbox toggle, autosave reflow)
     repreloads `/notes/_app/immutable/...` and the browser logs "preloaded
     but not used" warnings. -->
<div
  bind:this={containerEl}
  class="preview overflow-auto bg-background pt-4 pb-5 text-base md:text-sm leading-relaxed text-foreground {className}"
  aria-label={$t('editor.markdown_preview')}
  onclick={handleClick}
  role="presentation"
  data-sveltekit-preload-data="off"
  data-sveltekit-preload-code="off"
>
  {#if hasImagePlaceholders}
    <div class="load-all-images-row">
      <button type="button" class="load-all-images-btn">
        {$t('editor.image_load_all')}
      </button>
      {#if loadAllImagesHint}
        <span class="load-all-images-hint">
          {loadAllImagesHint}
          {#if settingsLinkLabel && settingsLinkHref}
            <!-- eslint-disable svelte/no-navigation-without-resolve (settingsLinkHref is pre-resolved by the caller) -->
            <a
              href={settingsLinkHref}
              class="load-all-images-settings-link"
              data-sveltekit-preload-data="off"
              data-sveltekit-preload-code="off"
            >
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {settingsLinkLabel}
            </a>
          {/if}
        </span>
      {/if}
    </div>
  {/if}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized with DOMPurify -->
  {@html html}
</div>

<style>
  /* Markdown typography — no external plugin needed */
  .preview :global(h1),
  .preview :global(h2),
  .preview :global(h3),
  .preview :global(h4),
  .preview :global(h5),
  .preview :global(h6) {
    font-weight: 600;
    line-height: 1.3;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    /* Breathing room when an in-note/cross-note anchor scrolls a heading to the
       top of the preview, so it doesn't sit flush against the container edge. */
    scroll-margin-top: 0.75rem;
  }
  .preview :global(:first-child) {
    margin-top: 0;
  }
  .preview :global(h1 + h2),
  .preview :global(h1 + h3),
  .preview :global(h2 + h3) {
    margin-top: 0.75em;
  }
  .preview :global(h1) {
    font-size: 2rem;
  }
  .preview :global(h2) {
    font-size: 1.625rem;
  }
  .preview :global(h3) {
    font-size: 1.375rem;
  }
  .preview :global(h4) {
    font-size: 1.125rem;
  }
  .preview :global(h5) {
    font-size: 1rem;
  }
  .preview :global(h6) {
    font-size: 0.9375rem;
    color: var(--muted-foreground);
  }

  @media (min-width: 768px) {
    .preview :global(h1) {
      font-size: 1.875rem;
    }
    .preview :global(h2) {
      font-size: 1.5rem;
    }
    .preview :global(h3) {
      font-size: 1.25rem;
    }
    .preview :global(h4) {
      font-size: 1.0625rem;
    }
    .preview :global(h5) {
      font-size: 0.9375rem;
    }
    .preview :global(h6) {
      font-size: 0.875rem;
    }
  }

  .preview :global(p) {
    margin-top: 0;
    margin-bottom: 1em;
    line-height: 1.75;
  }

  .preview :global(a) {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .preview :global(a:hover) {
    opacity: 0.8;
  }

  /* Internal note links — visually distinct from external links */
  .preview :global(a[data-note-link]) {
    color: var(--primary);
    text-decoration: underline;
    text-decoration-style: dashed;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .preview :global(a[data-note-link])::before {
    content: '📝 ';
    font-size: 0.8em;
  }
  .preview :global(a[data-note-link]:hover) {
    opacity: 1;
    text-decoration-style: solid;
  }

  .preview :global(ul),
  .preview :global(ol) {
    margin: 0 0 1em 1.5em;
    padding: 0;
    line-height: 1.75;
  }
  .preview :global(ul) {
    list-style-type: disc;
  }
  .preview :global(ol) {
    list-style-type: decimal;
  }
  .preview :global(li + li) {
    margin-top: 0.25em;
  }

  /* Tapered indent ramp - mirrors the bullet/ordered depth rules in
     editor/live-preview/theme.ts so Preview and Live Preview render nested
     lists with the same geometry. The renderer in this component stamps
     data-d="N" on every ul/ol (1..12, clamped). margin-left here is the
     delta from the parent list's content edge - d2..d12 stack on top of the
     d1 base (1.5em), giving cumulative offsets that match Live Preview's
     absolute paddings. d2 has the larger 2.5em step so a nested item sits
     visibly past the parent's content; d3..d6 keep the 1.5em rhythm; d7..d12
     taper to 0.75em so deep trees stay usable on a 360px viewport. */
  .preview :global(ul[data-d='1']),
  .preview :global(ol[data-d='1']) {
    margin-left: 1.5em;
  }
  /* First-level ol gets extra room: outside markers hang LEFT of the li
     content edge, and `.preview` is a scroll container (overflow-auto), so
     anything past its padding box is clipped. 1.5em fits a 2-digit marker
     ("10.") with ~1px slack in Blink/Gecko, but WebKit lays the marker out
     with a wider marker-to-content gap and clips the leading digit (#262,
     Safari macOS/iOS). 2em covers 2 digits in all engines (GitHub uses the
     same value); 100+ item lists escalate to 2.75em for the third digit.
     Only d1 is at risk - nested lists hang markers over ancestor indents,
     which sit safely inside the clip box. Live Preview is unaffected (the
     number there is source text, not a ::marker), so this is a deliberate
     0.5em divergence from .cm-lp-ordered-d1. */
  .preview :global(ol[data-d='1']) {
    margin-left: 2em;
  }
  .preview :global(ol[data-d='1']:has(> li:nth-child(100))) {
    margin-left: 2.75em;
  }
  .preview :global(ul[data-d='2']),
  .preview :global(ol[data-d='2']) {
    margin-left: 2.5em;
  }
  .preview :global(ul[data-d='3']),
  .preview :global(ol[data-d='3']),
  .preview :global(ul[data-d='4']),
  .preview :global(ol[data-d='4']),
  .preview :global(ul[data-d='5']),
  .preview :global(ol[data-d='5']),
  .preview :global(ul[data-d='6']),
  .preview :global(ol[data-d='6']) {
    margin-left: 1.5em;
  }
  .preview :global(ul[data-d='7']),
  .preview :global(ol[data-d='7']),
  .preview :global(ul[data-d='8']),
  .preview :global(ol[data-d='8']),
  .preview :global(ul[data-d='9']),
  .preview :global(ol[data-d='9']),
  .preview :global(ul[data-d='10']),
  .preview :global(ol[data-d='10']),
  .preview :global(ul[data-d='11']),
  .preview :global(ol[data-d='11']),
  .preview :global(ul[data-d='12']),
  .preview :global(ol[data-d='12']) {
    margin-left: 0.75em;
  }

  .preview :global(blockquote) {
    margin: 0 0 1em;
    padding: 0.5em 1em;
    border-left: 3px solid var(--border);
    color: var(--muted-foreground);
    font-style: italic;
  }

  .preview :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.875em;
    padding: 0.15em 0.4em;
    border-radius: 0.375em;
    background: var(--muted);
    color: var(--foreground);
  }

  .preview :global(pre),
  .preview :global(pre.cm-lp-codeblock) {
    margin: 0 0 1em;
    padding: 1em;
    border-radius: 0.5em;
    background: var(--muted);
    overflow-x: auto;
    line-height: 1.6;
    /* Match the <code> font-size so the <pre>'s line-box strut tracks the
       glyphs. A larger strut (inherited 1rem on mobile vs 0.875rem code) puts
       extra space inside each line box and skews where a click maps to a line.
       Explicit `white-space`/`user-select` keep code reliably selectable. */
    font-size: 0.875rem;
    white-space: pre;
    -webkit-user-select: text;
    user-select: text;
  }
  .preview :global(pre code) {
    padding: 0;
    background: transparent;
    font-size: inherit;
  }

  /* Fenced code block + copy button. `.code-block` is the positioning context
     (overflow visible) so the absolutely-placed button stays pinned to the
     top-right while the <pre> (the scroll container) scrolls under it. */
  .preview :global(.code-block) {
    position: relative;
  }
  .preview :global(.code-copy-btn) {
    position: absolute;
    top: 0.4em;
    right: 0.4em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9em;
    height: 1.9em;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.375em;
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    opacity: 0.55;
    -webkit-user-select: none;
    user-select: none;
    transition:
      opacity 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .preview :global(.code-block:hover .code-copy-btn),
  .preview :global(.code-copy-btn:hover),
  .preview :global(.code-copy-btn:focus-visible) {
    opacity: 1;
    color: var(--foreground);
  }
  .preview :global(.code-copy-btn.is-copied) {
    opacity: 1;
    color: #16a34a;
    border-color: #16a34a;
  }

  /* Per-heading "copy link" button (owner-editable preview). `assignHeadingIds`
     appends it inline at the end of each heading, so it sits right after the
     text - mirrors the Live Preview `.cm-lp-head-anchor` affordance. Hidden
     until the heading is hovered / the button focused (desktop); on coarse
     pointers (touch, no hover) it stays faintly visible so it is discoverable. */
  .preview :global(.md-head-anchor) {
    display: inline-flex;
    vertical-align: middle;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    margin-left: 0.4em;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.375em;
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    opacity: 0;
    -webkit-user-select: none;
    user-select: none;
    transition:
      opacity 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .preview :global(:is(h1, h2, h3, h4, h5, h6):hover .md-head-anchor),
  .preview :global(.md-head-anchor:focus-visible) {
    opacity: 1;
  }
  .preview :global(.md-head-anchor:hover) {
    opacity: 1;
    color: var(--foreground);
  }
  @media (hover: none) {
    .preview :global(.md-head-anchor) {
      opacity: 0.55;
    }
  }

  /* In-note table of contents (owner-editable preview only). `.note-toc` is the
     positioning context for its corner toolbar - mirrors `.code-block`. Read-only
     viewers (shared snapshot, history) never get this wrapper; they render a
     plain bold title + list. */
  .preview :global(.note-toc) {
    position: relative;
    margin: 0 0 1em;
    padding: 0.75em 1em;
    border: 1px solid var(--border);
    border-radius: 0.5em;
    background: color-mix(in srgb, var(--muted) 40%, transparent);
  }
  .preview :global(.note-toc p) {
    margin: 0 0 0.5em;
    font-size: 0.9375rem;
  }
  .preview :global(.note-toc ul) {
    margin: 0 0 0 1.1em;
    list-style: none;
  }
  .preview :global(.note-toc ul ul) {
    margin-bottom: 0;
  }
  .preview :global(.note-toc li + li) {
    margin-top: 0.15em;
  }
  /* Hover/focus-revealed corner toolbar. When the TOC is out of date the whole
     group is force-shown via :has() - a child can't out-opaque its parent, so the
     reveal has to live on `.note-toc-actions`. */
  .preview :global(.note-toc-actions) {
    position: absolute;
    top: 0.4em;
    right: 0.4em;
    display: inline-flex;
    gap: 0.25em;
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .preview :global(.note-toc:hover .note-toc-actions),
  .preview :global(.note-toc:focus-within .note-toc-actions),
  .preview :global(.note-toc:has(.note-toc-refresh.is-stale) .note-toc-actions) {
    opacity: 1;
  }
  .preview :global(.note-toc-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9em;
    height: 1.9em;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.375em;
    background: var(--background);
    color: var(--muted-foreground);
    cursor: pointer;
    -webkit-user-select: none;
    user-select: none;
    transition:
      color 0.12s ease,
      border-color 0.12s ease,
      background 0.12s ease;
  }
  .preview :global(.note-toc-btn:hover),
  .preview :global(.note-toc-btn:focus-visible) {
    color: var(--foreground);
    background: var(--accent);
  }
  .preview :global(.note-toc-remove:hover) {
    color: var(--destructive);
    border-color: var(--destructive);
  }
  /* Out of date: refresh button stays visible + amber so the drift is noticed. */
  .preview :global(.note-toc-refresh.is-stale) {
    color: #d97706;
    border-color: #d97706;
  }

  /* Syntax highlight tokens — palette mirrors editor/live-preview/theme.ts.
     Kept here (not in a global stylesheet) so Preview and Live Preview share
     the visual output without coupling MarkdownPreview to CM6 internals. */
  .preview :global(pre code .tok-keyword),
  .preview :global(pre code .tok-controlKeyword),
  .preview :global(pre code .tok-moduleKeyword),
  .preview :global(pre code .tok-operatorKeyword),
  .preview :global(pre code .tok-definitionKeyword) {
    color: #708;
  }
  .preview :global(pre code .tok-atom),
  .preview :global(pre code .tok-bool) {
    color: #219;
  }
  .preview :global(pre code .tok-number) {
    color: #164;
  }
  .preview :global(pre code .tok-string) {
    color: #a11;
  }
  .preview :global(pre code .tok-special.tok-string),
  .preview :global(pre code .tok-regexp),
  .preview :global(pre code .tok-escape) {
    color: #e40;
  }
  .preview :global(pre code .tok-comment),
  .preview :global(pre code .tok-lineComment),
  .preview :global(pre code .tok-blockComment) {
    color: #940;
    font-style: italic;
  }
  .preview :global(pre code .tok-meta) {
    color: #555;
  }
  .preview :global(pre code .tok-variableName) {
    color: #00f;
  }
  .preview :global(pre code .tok-typeName),
  .preview :global(pre code .tok-macroName) {
    color: #085;
  }
  .preview :global(pre code .tok-className),
  .preview :global(pre code .tok-namespace) {
    color: #167;
  }
  .preview :global(pre code .tok-propertyName),
  .preview :global(pre code .tok-attributeName) {
    color: #00c;
  }
  .preview :global(pre code .tok-tagName),
  .preview :global(pre code .tok-labelName) {
    color: #170;
  }
  .preview :global(pre code .tok-link) {
    color: #219;
    text-decoration: underline;
  }
  .preview :global(pre code .tok-heading),
  .preview :global(pre code .tok-strong) {
    font-weight: 700;
  }
  .preview :global(pre code .tok-emphasis) {
    font-style: italic;
  }
  .preview :global(pre code .tok-deleted) {
    color: #a11;
    text-decoration: line-through;
  }
  .preview :global(pre code .tok-inserted) {
    color: #164;
  }
  .preview :global(pre code .tok-invalid) {
    color: #f00;
  }

  /* Dark-mode token palette — mirrors NoteEditor.svelte's `.dark .cm-lp-codeblock .tok-*`. */
  :global(.dark) .preview :global(pre code .tok-keyword),
  :global(.dark) .preview :global(pre code .tok-controlKeyword),
  :global(.dark) .preview :global(pre code .tok-moduleKeyword),
  :global(.dark) .preview :global(pre code .tok-operatorKeyword),
  :global(.dark) .preview :global(pre code .tok-definitionKeyword) {
    color: #c792ea;
  }
  :global(.dark) .preview :global(pre code .tok-atom),
  :global(.dark) .preview :global(pre code .tok-bool),
  :global(.dark) .preview :global(pre code .tok-number) {
    color: #f78c6c;
  }
  :global(.dark) .preview :global(pre code .tok-string),
  :global(.dark) .preview :global(pre code .tok-special.tok-string),
  :global(.dark) .preview :global(pre code .tok-regexp),
  :global(.dark) .preview :global(pre code .tok-escape) {
    color: #c3e88d;
  }
  :global(.dark) .preview :global(pre code .tok-comment),
  :global(.dark) .preview :global(pre code .tok-lineComment),
  :global(.dark) .preview :global(pre code .tok-blockComment) {
    color: #7c8a99;
  }
  :global(.dark) .preview :global(pre code .tok-variableName),
  :global(.dark) .preview :global(pre code .tok-propertyName),
  :global(.dark) .preview :global(pre code .tok-attributeName) {
    color: #82aaff;
  }
  :global(.dark) .preview :global(pre code .tok-typeName),
  :global(.dark) .preview :global(pre code .tok-className),
  :global(.dark) .preview :global(pre code .tok-namespace),
  :global(.dark) .preview :global(pre code .tok-macroName) {
    color: #7fdbca;
  }
  :global(.dark) .preview :global(pre code .tok-tagName),
  :global(.dark) .preview :global(pre code .tok-labelName) {
    color: #f07178;
  }

  .preview :global(hr) {
    margin: 1.5em 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  /* Tables sit inside `.table-wrap` (see $derived html). The wrapper owns the
     horizontal scroll so a row of long unbreakable tokens (file paths,
     SCREAMING_SNAKE constants) gets its own scrollbar attached to the table,
     not stranded at the bottom of the whole preview. */
  .preview :global(.table-wrap) {
    overflow-x: auto;
    margin-bottom: 1em;
    max-width: 100%;
  }
  .preview :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
  }
  .preview :global(th),
  .preview :global(td) {
    padding: 0.5em 0.75em;
    border: 1px solid var(--border);
    text-align: left;
  }
  .preview :global(th) {
    background: var(--muted);
    font-weight: 600;
  }

  .preview :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.375em;
  }

  /* Checklist items (GFM task lists). `task-list-item` drops the default
     bullet; the checkbox itself is pulled back into the bullet space below.
     Mirrors GitHub's CSS. `task-list-item-checked` adds strikethrough + muted
     color, matching Live Preview's `cm-lp-task-checked`. */
  .preview :global(li.task-list-item) {
    list-style-type: none;
  }
  /* Strikethrough + muted colour scoped to the parent's own inline-content
     wrapper. Each GFM task is independent state, so a checked parent must
     not visually mark its children as done. Putting the decoration on the
     `<li>` itself made it propagate (text-decoration is "drawn through"
     inline descendants of the line box, and `text-decoration: none` on a
     descendant block does not cancel the parent's drawn line). The renderer
     wraps the parent's inline content in `<span class="task-list-item-content">`
     so any nested `<ul>`/`<ol>` is a *sibling* of this wrapper, not a
     descendant — the line ends at the wrapper boundary. */
  .preview :global(li.task-list-item-checked) > :global(.task-list-item-content) {
    text-decoration: line-through;
    color: var(--muted-foreground);
  }
  .preview :global(input[type='checkbox']) {
    margin-right: 0.4em;
    accent-color: var(--primary);
  }
  /* Pull the checkbox into the bullet zone (GitHub-style). Putting the
     negative margin on the checkbox — not on the <li> — leaves the list-
     item's box untouched, so each nested level still gets its full indent
     from the parent ul's `[data-d='N']` margin ramp. The previous approach
     (`li.task-list-item { margin-left: -1.5em }`) cancelled the d3+ ramp
     exactly, collapsing every deeper level into the same column as d2. */
  .preview :global(.task-list-item-checkbox) {
    cursor: pointer;
    transform: translateY(-1px);
    margin-left: -1.4em;
  }

  /* ── Image placeholders ─────────────────────────────────────
     Inline-flex layout shared with Live Preview (theme.ts) for visual
     parity. URL wraps on long paths so the user can audit the full
     destination before deciding to load. */
  .preview :global(.image-placeholder) {
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.4em 0.75em;
    margin: 0.25em 0;
    border: 2px dashed var(--border);
    border-radius: 0.5em;
    background: var(--muted);
    font-size: 0.875rem;
    max-width: 100%;
    vertical-align: middle;
  }

  .preview :global(.image-placeholder--blocked) {
    border-color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 8%, var(--muted));
  }

  .preview :global(.image-placeholder-icon) {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    color: var(--muted-foreground);
  }

  .preview :global(.image-placeholder-url) {
    color: var(--muted-foreground);
    word-break: break-all;
    flex: 1 1 auto;
    min-width: 0;
  }

  .preview :global(.image-placeholder-load) {
    padding: 0.25em 0.75em;
    border-radius: 0.375em;
    background: var(--primary);
    color: var(--primary-foreground);
    border: none;
    cursor: pointer;
    font-size: 0.8125rem;
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .preview :global(.image-placeholder-load:hover) {
    opacity: 0.9;
  }

  /* ── Load all images button + optional hint ──────────────────
     Row owns the bottom margin so adding/removing the hint never
     shifts the button's spacing. `flex-wrap` lets the hint drop
     below the button on narrow viewports instead of squeezing it.

     When `loadAllImagesHint` is set (share viewer context, see
     NoteSnapshotView), `:has()` upgrades the row into a notice
     banner with bg + border to anchor the privacy hint visually.
     Owner-side previews (no hint) keep the bare-row layout. */
  .load-all-images-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em 0.75em;
    margin: 0 0 1em;
  }

  .load-all-images-row:has(.load-all-images-hint) {
    padding: 0.625em 0.875em;
    border: 1px solid var(--border);
    border-radius: 0.5em;
    background: var(--muted);
    margin-bottom: 1.25em;
  }

  .load-all-images-btn {
    padding: 0.4em 1em;
    border-radius: 0.375em;
    background: var(--background);
    color: var(--foreground);
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.8rem;
    flex: 0 0 auto;
  }

  .load-all-images-btn:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .load-all-images-hint {
    color: var(--muted-foreground);
    font-size: 0.75rem;
    line-height: 1.4;
    flex: 1 1 200px;
    min-width: 0;
  }

  .load-all-images-settings-link {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    margin-left: 0.25em;
  }

  .load-all-images-settings-link:hover {
    opacity: 0.85;
  }
</style>
