<script lang="ts">
  import { onMount } from 'svelte';
  import { X, Lock, Eye, Server } from '@lucide/svelte';
  import { getRawEncryptedNote } from '$lib/services/note.service';
  import { t } from '$lib/stores/i18n.store';

  let {
    noteId,
    plainTitle,
    plainContent,
    onclose
  }: {
    noteId: string;
    plainTitle: string;
    plainContent: string;
    onclose: () => void;
  } = $props();

  // ── Tunables ────────────────────────────────────────────────────
  // Per-device split position. localStorage (not synced) is deliberate:
  // a UI preference, not user data, so it never touches the server.
  const STORAGE_KEY = 'reborn-notes:xray-split';
  const SNAP_POINTS = [25, 50, 75]; // magnet stops
  const SNAP_THRESHOLD = 4; // % window around each snap point
  const MIN_POS = 8; // keep a sliver of both panes visible
  const MAX_POS = 92;
  const STEP = 5; // arrow key step
  const STEP_LARGE = 25; // shift + arrow step

  // ── Math + persistence helpers (declarations hoist above $state) ─
  function clampPos(v: number): number {
    return Math.max(MIN_POS, Math.min(MAX_POS, v));
  }

  function applySnap(v: number): number {
    for (const p of SNAP_POINTS) {
      if (Math.abs(v - p) <= SNAP_THRESHOLD) return p;
    }
    return v;
  }

  function loadSplit(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw != null) {
        const v = Number(raw);
        if (Number.isFinite(v)) return clampPos(v);
      }
    } catch {
      /* private mode / disabled storage - fall through to default */
    }
    return 50; // default 50/50
  }

  function saveSplit(v: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(v)));
    } catch {
      /* ignore */
    }
  }

  // ── State ───────────────────────────────────────────────────────
  let containerEl: HTMLDivElement | undefined = $state();
  let handleEl: HTMLDivElement | undefined = $state();
  let sliderPosition = $state(loadSplit());
  let isDragging = $state(false);
  let titleEncrypted = $state('');
  let contentEncrypted = $state('');
  let metadataEncrypted = $state('');
  let loading = $state(true);
  let visible = $state(false);
  let reduceMotion = $state(false);

  /** Commit a new split position: snap, clamp, optionally persist. */
  function setPosition(v: number, persist = true): void {
    sliderPosition = clampPos(applySnap(v));
    if (persist) saveSplit(sliderPosition);
  }

  // ── Fetch real ciphertext ───────────────────────────────────────
  onMount(() => {
    reduceMotion =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    let cancelled = false;
    getRawEncryptedNote(noteId).then((raw) => {
      if (cancelled) return;
      if (raw) {
        titleEncrypted = raw.title_encrypted;
        contentEncrypted = raw.content_encrypted;
        metadataEncrypted = raw.metadata_encrypted ?? '';
      }
      loading = false;
      // Trigger entrance + one-shot scan animation on the next frame.
      requestAnimationFrame(() => {
        visible = true;
      });
    });

    return () => {
      cancelled = true;
    };
  });

  // ── Pointer-based slider drag ───────────────────────────────────
  function updateFromPointer(e: PointerEvent): void {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    // Persist on release, not on every move.
    setPosition(pct, false);
  }

  function handlePointerDown(e: PointerEvent): void {
    isDragging = true;
    handleEl?.focus({ preventScroll: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e);
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isDragging) return;
    e.preventDefault();
    updateFromPointer(e);
  }

  function handlePointerUp(e: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    saveSplit(sliderPosition);
  }

  /** Double-click anywhere on the handle resets to a centered 50/50. */
  function handleReset(): void {
    setPosition(50);
  }

  // ── Keyboard ────────────────────────────────────────────────────
  function handleSeparatorKeydown(e: KeyboardEvent): void {
    let next: number;
    const big = e.shiftKey;
    switch (e.key) {
      case 'ArrowLeft':
        next = sliderPosition - (big ? STEP_LARGE : STEP);
        break;
      case 'ArrowRight':
        next = sliderPosition + (big ? STEP_LARGE : STEP);
        break;
      case 'Home':
        next = SNAP_POINTS[0]; // 25%
        break;
      case 'End':
        next = SNAP_POINTS[SNAP_POINTS.length - 1]; // 75%
        break;
      case 'Enter':
      case ' ':
        next = 50; // keyboard equivalent of double-click reset
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    setPosition(next);
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose();
  }

  // ── Format ciphertext for display ───────────────────────────────
  function formatCipher(label: string, value: string): string {
    if (!value) return `${label}: [empty]`;
    // Split iv:ciphertext and show both parts.
    const colonIdx = value.indexOf(':');
    if (colonIdx > 0) {
      const iv = value.slice(0, colonIdx);
      const cipher = value.slice(colonIdx + 1);
      return `${label}:\n  iv:     ${iv}\n  cipher: ${cipher}`;
    }
    return `${label}: ${value}`;
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<!-- Overlay: absolute inset-0 over the viewport-bounded scroll-container wrapper
     (mounted as a sibling of the editor scroll container, NOT inside the
     scrolling content) so it always fills the visible editor area regardless of
     note length or scroll position. -->
<div
  class="absolute inset-0 z-50 flex flex-col bg-zinc-900 transition-opacity duration-200
         {visible ? 'opacity-100' : 'opacity-0'}"
>
  <!-- Header -->
  <div
    class="flex shrink-0 items-center gap-3 border-b border-emerald-500/30
           bg-zinc-900/95 px-4 py-2 backdrop-blur-sm"
  >
    <Lock class="h-4 w-4 text-emerald-400" />
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-semibold text-emerald-400">{$t('encryption.title')}</h3>
      <p class="truncate text-xs text-zinc-400">
        {$t('encryption.server_view_desc')}
      </p>
    </div>
    <button
      type="button"
      onclick={onclose}
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md
             text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      aria-label={$t('encryption.close')}
    >
      <X class="h-4 w-4" />
    </button>
  </div>

  <!-- Comparison area -->
  {#if loading}
    <div class="flex flex-1 items-center justify-center bg-zinc-900/95">
      <div class="flex items-center gap-2 text-sm text-zinc-400">
        <div
          class="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"
        ></div>
        {$t('encryption.loading')}
      </div>
    </div>
  {:else}
    <div bind:this={containerEl} class="relative flex-1 select-none overflow-hidden">
      <!-- Left: Plaintext layer ("your view") -->
      <div
        class="absolute inset-0 overflow-auto bg-background"
        style="clip-path: inset(0 {100 - sliderPosition}% 0 0);"
      >
        <div class="min-h-full px-6 py-5">
          <div
            class="mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
          >
            <Eye class="h-3.5 w-3.5" />
            {$t('encryption.your_view')}
          </div>
          <h2 class="mb-4 text-lg font-semibold text-foreground">
            {plainTitle || $t('notes.untitled')}
          </h2>
          {#if plainContent}
            <pre
              class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">{plainContent}</pre>
          {:else}
            <!-- Empty/short note: still demonstrable - the right pane shows the
                 ciphertext of the (encrypted) title + metadata. -->
            <p class="text-sm italic text-muted-foreground">{$t('encryption.empty_note')}</p>
          {/if}
        </div>
      </div>

      <!-- Right: Ciphertext layer ("server view") -->
      <div
        class="absolute inset-0 overflow-auto bg-zinc-900"
        style="clip-path: inset(0 0 0 {sliderPosition}%);"
      >
        <div class="min-h-full px-6 py-5 pl-10">
          <div
            class="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400"
          >
            <Server class="h-3.5 w-3.5" />
            {$t('encryption.server_view')}
          </div>
          <pre
            class="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-emerald-400/90">{formatCipher(
              'title_encrypted',
              titleEncrypted
            )}

{formatCipher('content_encrypted', contentEncrypted)}

{formatCipher('metadata_encrypted', metadataEncrypted)}</pre>
        </div>
      </div>

      <!-- One-shot "scan" sweep on open (disabled under reduced motion) -->
      {#if visible && !reduceMotion}
        <div class="xray-scan pointer-events-none absolute inset-y-0 z-10" aria-hidden="true"></div>
      {/if}

      <!-- Vertical seam + draggable handle (the separator).
           A focusable separator IS a valid interactive pattern (the window-
           splitter role with aria-valuenow + arrow keys), so the generic
           "non-interactive element" a11y hints are false positives here. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={handleEl}
        class="group absolute inset-y-0 z-20 flex w-11 -translate-x-1/2 cursor-col-resize touch-none
               items-center justify-center outline-none"
        style="left: {sliderPosition}%;"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(sliderPosition)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={$t('encryption.slider_label')}
        title={$t('encryption.reset_hint')}
        tabindex={0}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        ondblclick={handleReset}
        onkeydown={handleSeparatorKeydown}
      >
        <!-- Scan-line seam: thin edge with brand-green glow -->
        <div class="xray-seam pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2"></div>

        <!-- Grip pill with dots -->
        <div
          class="pointer-events-none relative grid grid-cols-2 gap-x-1 gap-y-1 rounded-full
                 border border-emerald-400/60 bg-zinc-800/95 px-1.5 py-2.5 shadow-lg
                 shadow-emerald-500/20 transition-transform duration-150
                 group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-emerald-300
                 {isDragging ? 'scale-110' : ''}"
        >
          {#each [0, 1, 2, 3, 4, 5] as dot (dot)}
            <span class="h-1 w-1 rounded-full bg-emerald-400"></span>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* One-shot horizontal scan sweep, like an X-ray scanner passing over. */
  @keyframes xray-sweep {
    0% {
      left: -20%;
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      left: 100%;
      opacity: 0;
    }
  }

  .xray-scan {
    width: 22%;
    opacity: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, #10b981 16%, transparent) 50%,
      transparent
    );
    animation: xray-sweep 900ms ease-out forwards;
  }

  /* Seam: a thin vertical line that glows in brand-green. */
  .xray-seam {
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, #10b981 85%, transparent),
      transparent
    );
    box-shadow: 0 0 8px 1px color-mix(in srgb, #10b981 60%, transparent);
    transition: box-shadow 150ms ease;
  }
  .group:hover .xray-seam,
  .group:focus-visible .xray-seam {
    box-shadow: 0 0 12px 2px color-mix(in srgb, #10b981 80%, transparent);
  }

  /* Respect reduced-motion: no sweep, no transitions. */
  @media (prefers-reduced-motion: reduce) {
    .xray-scan {
      display: none;
      animation: none;
    }
    .xray-seam {
      transition: none;
    }
  }
</style>
