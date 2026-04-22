<script lang="ts">
  import { onMount } from 'svelte';
  import { marked, type Tokens } from 'marked';
  import DOMPurify from 'dompurify';

  import { t } from '$lib/stores/i18n.store';
  import type { ImageLoadMode } from '@reborn/storage';

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
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ALLOWED_URI_REGEXP: ALLOWED_URI });
  }

  let {
    content = '',
    class: className = '',
    scrollEl = $bindable<HTMLElement | null>(null),
    imageLoadMode = 'ask' as ImageLoadMode,
    onNoteLink,
    resolveNoteTitle
  }: {
    content: string;
    class?: string;
    scrollEl?: HTMLElement | null;
    imageLoadMode?: ImageLoadMode;
    /** Called when user clicks a note:UUID link */
    onNoteLink?: (noteId: string) => void;
    /** Resolves current title for a note UUID (for auto-update display text) */
    resolveNoteTitle?: (noteId: string) => string | undefined;
  } = $props();

  let containerEl: HTMLElement;

  onMount(() => {
    scrollEl = containerEl;
  });

  // Configure marked renderer
  const renderer = new marked.Renderer();

  renderer.image = ({ href, title, text }: Tokens.Image) => {
    const isDataUri = href.startsWith('data:');
    const escapedHref = href.replace(/"/g, '&quot;');
    const escapedAlt = (text || '').replace(/"/g, '&quot;');
    const escapedTitle = (title || '').replace(/"/g, '&quot;');

    if (isDataUri) {
      return `<div class="image-placeholder image-placeholder--blocked">
      <div class="image-placeholder-icon">⚠️</div>
      <div class="image-placeholder-url">${$t('editor.image_base64_blocked')}</div>
    </div>`;
    }

    // External URL — behavior depends on imageLoadMode
    if (imageLoadMode === 'always') {
      return `<img src="${escapedHref}" alt="${escapedAlt}" title="${escapedTitle}" loading="lazy" />`;
    }

    const showLoadBtn = imageLoadMode === 'ask';
    return `<div class="image-placeholder" data-src="${escapedHref}" data-alt="${escapedAlt}" data-title="${escapedTitle}">
      <div class="image-placeholder-icon">🖼️</div>
      <div class="image-placeholder-url">${escapedHref}</div>
      ${showLoadBtn ? `<button class="image-placeholder-load" type="button">${$t('editor.image_load')}</button>` : ''}
    </div>`;
  };

  marked.use({ renderer, gfm: true, breaks: true });

  const html = $derived.by(() => {
    if (!content) return '';
    const raw = sanitize(marked.parse(content) as string);
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

<div
  bind:this={containerEl}
  class="preview overflow-auto bg-background pt-4 pb-5 text-base md:text-sm leading-relaxed text-foreground {className}"
  aria-label={$t('editor.markdown_preview')}
  onclick={handleClick}
  role="presentation"
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

  .preview :global(pre) {
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

  /* Checklist items (GFM task lists) */
  .preview :global(input[type='checkbox']) {
    margin-right: 0.4em;
    accent-color: var(--primary);
  }

  /* ── Image placeholders ───────────────────────────────────── */
  .preview :global(.image-placeholder) {
    margin: 1em 0;
    padding: 1em;
    border: 2px dashed var(--border);
    border-radius: 0.5em;
    background: var(--muted);
    text-align: center;
    font-size: 0.875rem;
  }

  .preview :global(.image-placeholder--blocked) {
    border-color: var(--destructive);
    background: color-mix(in srgb, var(--destructive) 8%, var(--muted));
  }

  .preview :global(.image-placeholder-icon) {
    font-size: 2rem;
    margin-bottom: 0.5em;
  }

  .preview :global(.image-placeholder-url) {
    color: var(--muted-foreground);
    word-break: break-all;
    margin-bottom: 0.75em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview :global(.image-placeholder-load) {
    padding: 0.4em 1em;
    border-radius: 0.375em;
    background: var(--primary);
    color: var(--primary-foreground);
    border: none;
    cursor: pointer;
    font-size: 0.875rem;
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
