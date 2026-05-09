<script lang="ts">
  import { onMount } from 'svelte';
  import { Marked, type Tokens, type RendererObject } from 'marked';
  import DOMPurify from 'dompurify';

  import { t } from '$lib/stores/i18n.store';
  import type { ImageLoadMode } from '@reborn/storage';
  import {
    highlightCodeToHtml,
    triggerLanguageLoad
  } from '$lib/editor/live-preview';
  import {
    annotateTopLevelLines,
    applySourceLineAttrs
  } from '$lib/utils/source-line';
  import { createMarkdownListRenderers } from '$lib/utils/markdown-to-html';

  const NOTE_LINK_RE = /^note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

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
    scrollEl = $bindable<HTMLElement | null>(null),
    contentEl = $bindable<HTMLElement | null>(null),
    imageLoadMode = 'ask' as ImageLoadMode,
    onNoteLink,
    onTaskToggle,
    onrender,
    resolveNoteTitle
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
    /** Called when user clicks a note:UUID link */
    onNoteLink?: (noteId: string) => void;
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
     * Fired after the rendered HTML is committed to the DOM (and
     * `data-source-line` attrs are stamped). The parent uses this to
     * rebuild line-anchor caches in the scroll-sync.
     */
    onrender?: () => void;
    /** Resolves current title for a note UUID (for auto-update display text) */
    resolveNoteTitle?: (noteId: string) => string | undefined;
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

  // List / task-list renderers are shared with `exportNoteAsPdf` so the PDF
  // pipeline emits the same `task-list-item` markup (no double bullet, scoped
  // strikethrough). Image / code below stay Preview-specific.
  const { renderer: listRenderers, reset: resetListCounters } =
    createMarkdownListRenderers();
  const renderer: RendererObject = { ...listRenderers };

  // "Pinned" snapshot of the prop, synced at the start of every $derived html
  // recomputation. The renderer.image closure reads this regular variable
  // instead of `imageLoadMode` directly because:
  //   1. Reading a Svelte 5 prop at script init (outside any reactive scope)
  //      captures only the *initial* value, not the reactive binding —
  //      svelte-check explicitly warns about this. The renderer is set up at
  //      script init, so a direct closure over `imageLoadMode` would freeze
  //      to 'ask' forever (the bug fixed in this commit).
  //   2. `marked.parser()` calls renderer.image from a third-party call stack
  //      with no reactive context; there's nothing for Svelte to attach the
  //      read to even if it happened lazily.
  // Initial value is a literal placeholder; the real value is assigned inside
  // the `$derived html` block before each parse.
  let imageModeSnapshot: ImageLoadMode = 'ask';

  const IMAGE_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  const BLOCKED_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  renderer.image = ({ href, title, text }: Tokens.Image) => {
    const isDataUri = href.startsWith('data:');
    const escapedHref = href.replace(/"/g, '&quot;');
    const escapedAlt = (text || '').replace(/"/g, '&quot;');
    const escapedTitle = (title || '').replace(/"/g, '&quot;');

    if (isDataUri) {
      return `<div class="image-placeholder image-placeholder--blocked">
      <div class="image-placeholder-icon">${BLOCKED_ICON_SVG}</div>
      <div class="image-placeholder-url">${$t('editor.image_base64_blocked')}</div>
    </div>`;
    }

    if (imageModeSnapshot === 'always') {
      return `<img src="${escapedHref}" alt="${escapedAlt}" title="${escapedTitle}" loading="lazy" />`;
    }

    const showLoadBtn = imageModeSnapshot === 'ask';
    return `<div class="image-placeholder" data-src="${escapedHref}" data-alt="${escapedAlt}" data-title="${escapedTitle}">
      <div class="image-placeholder-icon">${IMAGE_ICON_SVG}</div>
      <div class="image-placeholder-url">${escapedHref}</div>
      ${showLoadBtn ? `<button class="image-placeholder-load" type="button">${$t('editor.image_load')}</button>` : ''}
    </div>`;
  };

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
    return highlightCodeToHtml(text, info);
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
    //  - `imageLoadMode` is read explicitly via assignment. The assignment
    //    can't be DCE'd (it has a side effect), guaranteeing the prop is
    //    tracked as a dep even if the compiler ever optimises plain reads.
    //    The snapshot is consumed by `renderer.image` via the regular
    //    variable `imageModeSnapshot`, sidestepping any uncertainty about
    //    whether Svelte tracks reads inside a closure invoked from marked.
    void langLoadTick;
    imageModeSnapshot = imageLoadMode;
    // Defensive reset — renderer.list decrements after each list, so under
    // normal flow listDepth is already 0; resetting guards against a thrown
    // sanitize/parse leaving the counters stuck, and starts taskCounter at 0
    // so `data-task-index` aligns with the markdown source's marker order.
    resetListCounters();
    if (!content) {
      lastTokens = [];
      return '';
    }
    const tokens = md.lexer(content);
    annotateTopLevelLines(tokens);
    lastTokens = tokens;
    const raw = sanitize(md.parser(tokens) as string);
    if (!resolveNoteTitle) return raw;
    return raw.replace(
      /<a ([^>]*?)href="note:([0-9a-f-]{36})"([^>]*?)>([^<]*)<\/a>/gi,
      (_match, pre, noteId, post, _text) => {
        const currentTitle = resolveNoteTitle(noteId);
        const displayText = currentTitle ?? _text;
        return `<a ${pre}href="note:${noteId}"${post}>${displayText}</a>`;
      }
    );
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
    onrender?.();

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

  function handleClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

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

    // Handle "Load all images" button
    if (target.closest('.load-all-images-btn')) {
      e.preventDefault();
      const placeholders = containerEl.querySelectorAll('.image-placeholder');
      placeholders.forEach((p) => loadImage(p as HTMLElement));
      target.closest('.load-all-images-btn')?.remove();
      return;
    }

    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href') || '';
    const noteMatch = href.match(NOTE_LINK_RE);

    if (noteMatch) {
      e.preventDefault();
      onNoteLink?.(noteMatch[1]);
      return;
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  // Check if there are image placeholders to show "Load all" button
  const hasImagePlaceholders = $derived(
    imageLoadMode === 'ask' && content && /!\[.*?\]\(https?:\/\//.test(content)
  );
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
    <button type="button" class="load-all-images-btn">
      {$t('editor.image_load_all')}
    </button>
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

  /* Tapered indent ramp — mirrors the bullet/ordered depth rules in
     editor/live-preview/theme.ts so Preview and Live Preview render nested
     lists with the same geometry. The renderer in this component stamps
     data-d="N" on every ul/ol (1..12, clamped). margin-left here is the
     delta from the parent list's content edge — d2..d12 stack on top of the
     d1 base (1.5em), giving cumulative offsets that match Live Preview's
     absolute paddings. d2 has the larger 2.5em step so a nested item sits
     visibly past the parent's content; d3..d6 keep the 1.5em rhythm; d7..d12
     taper to 0.75em so deep trees stay usable on a 360px viewport. */
  .preview :global(ul[data-d='1']),
  .preview :global(ol[data-d='1']) {
    margin-left: 1.5em;
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
  }
  .preview :global(pre code) {
    padding: 0;
    background: transparent;
    font-size: 0.875rem;
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

  .preview :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1em;
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
     bullet and pulls the line back so the checkbox sits where the bullet
     would. Mirrors GitHub's CSS. `task-list-item-checked` adds strikethrough
     + muted color, matching Live Preview's `cm-lp-task-checked`. */
  .preview :global(li.task-list-item) {
    list-style-type: none;
    margin-left: -1.5em;
    padding-left: 0;
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
  .preview :global(.task-list-item-checkbox) {
    cursor: pointer;
    transform: translateY(-1px);
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

  /* ── Load all images button ───────────────────────────────── */
  .load-all-images-btn {
    display: block;
    margin: 0 0 1em;
    padding: 0.4em 1em;
    border-radius: 0.375em;
    background: var(--muted);
    color: var(--muted-foreground);
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 0.8rem;
  }

  .load-all-images-btn:hover {
    background: var(--accent);
    color: var(--accent-foreground);
  }
</style>
