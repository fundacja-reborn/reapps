<script lang="ts">
  import { onMount } from 'svelte';
  import { X, Lock, GripVertical, Eye, Server } from '@lucide/svelte';
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

  // ── State ───────────────────────────────────────────────────────
  let containerEl: HTMLDivElement | undefined = $state();
  let sliderPosition = $state(65); // % from left — start mostly showing plaintext
  let isDragging = $state(false);
  let titleEncrypted = $state('');
  let contentEncrypted = $state('');
  let metadataEncrypted = $state('');
  let loading = $state(true);
  let visible = $state(false);

  // ── Fetch real ciphertext ───────────────────────────────────────
  onMount(async () => {
    const raw = await getRawEncryptedNote(noteId);
    if (raw) {
      titleEncrypted = raw.title_encrypted;
      contentEncrypted = raw.content_encrypted;
      metadataEncrypted = raw.metadata_encrypted ?? '';
    }
    loading = false;
    // Trigger entrance animation
    requestAnimationFrame(() => {
      visible = true;
    });
  });

  // ── Pointer-based slider drag ───────────────────────────────────
  function handlePointerDown(e: PointerEvent) {
    isDragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updatePosition(e);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    e.preventDefault();
    updatePosition(e);
  }

  function handlePointerUp() {
    isDragging = false;
  }

  function updatePosition(e: PointerEvent) {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(5, Math.min(95, (x / rect.width) * 100));
    sliderPosition = pct;
  }

  // ── Keyboard / Escape ───────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }

  // ── Format ciphertext for display ───────────────────────────────
  function formatCipher(label: string, value: string): string {
    if (!value) return `${label}: [empty]`;
    // Split iv:ciphertext and show both parts
    const colonIdx = value.indexOf(':');
    if (colonIdx > 0) {
      const iv = value.slice(0, colonIdx);
      const cipher = value.slice(colonIdx + 1);
      return `${label}:\n  iv:     ${iv}\n  cipher: ${cipher}`;
    }
    return `${label}: ${value}`;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Overlay backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="absolute inset-0 z-50 flex flex-col transition-all duration-200
         {visible ? 'opacity-100' : 'opacity-0'}"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <!-- Header -->
  <div
    class="flex shrink-0 items-center gap-3 border-b border-emerald-500/30
           bg-zinc-900/95 px-4 py-2 backdrop-blur-sm"
  >
    <Lock class="h-4 w-4 text-emerald-400" />
    <div class="min-w-0 flex-1">
      <h3 class="text-sm font-semibold text-emerald-400">Encryption X-Ray</h3>
      <p class="text-xs text-zinc-400">
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
    <div
      bind:this={containerEl}
      class="relative flex-1 select-none overflow-hidden"
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
    >
      <!-- Left: Plaintext layer -->
      <div
        class="absolute inset-0 overflow-auto bg-background"
        style="clip-path: inset(0 {100 - sliderPosition}% 0 0);"
      >
        <div class="px-6 py-5">
          <div
            class="mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs text-blue-400"
          >
            <Eye class="h-3.5 w-3.5" />
            {$t('encryption.your_view')}
          </div>
          <h2 class="mb-4 text-lg font-semibold text-foreground">
            {plainTitle || $t('notes.untitled')}
          </h2>
          <pre
            class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">{plainContent ||
              $t('encryption.empty_note')}</pre>
        </div>
      </div>

      <!-- Right: Ciphertext layer -->
      <div
        class="absolute inset-0 overflow-auto bg-zinc-900"
        style="clip-path: inset(0 0 0 {sliderPosition}%);"
      >
        <div class="px-6 py-5 pl-10">
          <div
            class="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400"
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

      <!-- Vertical slider divider -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="absolute top-0 bottom-0 z-10 -ml-[22px] w-[44px] cursor-col-resize touch-none"
        style="left: {sliderPosition}%;"
        onpointerdown={handlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(sliderPosition)}
        aria-valuemin={5}
        aria-valuemax={95}
        aria-label={$t('encryption.slider_label')}
        tabindex={0}
      >
        <!-- Visible line -->
        <div
          class="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-emerald-500/70"
        ></div>
        <!-- Grip handle -->
        <div
          class="absolute left-1/2 top-1/2 flex h-10 w-7 -translate-x-1/2 -translate-y-1/2 items-center
                 justify-center rounded-md border border-emerald-500/50 bg-zinc-800/95 shadow-lg
                 transition-transform {isDragging ? 'scale-110' : 'hover:scale-105'}"
        >
          <GripVertical class="h-4 w-4 text-emerald-400" />
        </div>
      </div>
    </div>
  {/if}
</div>
