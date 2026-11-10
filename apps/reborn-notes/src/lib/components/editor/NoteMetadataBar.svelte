<script lang="ts">
  import { tick } from 'svelte';
  import { Folder, Tag, Calendar } from '@lucide/svelte';
  import TagPicker from '$lib/components/TagPicker.svelte';
  import { t, locale } from '$lib/stores/i18n.store';
  import { intlLocale } from '@reborn/i18n';
  import { APPEARANCE_SWATCH_CLASS, isAppearanceColor } from '$lib/utils/appearance-colors';

  type ViewMode = 'edit' | 'split' | 'preview';

  let {
    isMobile,
    activeTrash,
    title,
    folderName = null,
    noteId,
    updatedAt = null,
    createdAt = null,
    effectiveViewMode = 'edit' as ViewMode,
    color = undefined,
    ontitleinput,
    onfolderclick,
    oncolorclick
  }: {
    isMobile: boolean;
    activeTrash: boolean;
    title: string;
    folderName: string | null;
    noteId: string;
    updatedAt: string | null;
    createdAt: string | null;
    effectiveViewMode?: ViewMode;
    /** Color mark key of the note; the row shows only when one is set. */
    color?: string;
    ontitleinput: (e: Event) => void;
    onfolderclick: () => void;
    /** Opens the note color dialog. */
    oncolorclick?: () => void;
  } = $props();

  const colorKey = $derived(isAppearanceColor(color) ? color : undefined);
  const colorName = $derived(colorKey ? $t(`colors.${colorKey}`) : '');

  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    autoResize(target);
    ontitleinput(e);
  }

  // Auto-resize on mount and when title changes externally
  $effect(() => {
    // Track title to re-run when it changes
    void title;
    if (textareaEl) {
      tick().then(() => {
        if (textareaEl) autoResize(textareaEl);
      });
    }
  });

  function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    try {
      const date = new Date(iso);
      const currentLocale = intlLocale($locale);
      return new Intl.DateTimeFormat(currentLocale, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch {
      return null;
    }
  }

  const formattedUpdatedAt = $derived(formatDate(updatedAt));
  const formattedCreatedAt = $derived(formatDate(createdAt));
</script>

<div
  class="shrink-0
    {isMobile ? 'border-b border-border/60 px-4 pb-3 pt-2' : 'px-5 pb-3 pt-4'}"
>
  <div class={isMobile ? '' : effectiveViewMode === 'split' ? '' : 'mx-auto max-w-3xl'}>
  <!-- Editable title -->
  {#if activeTrash}
    <h1
      dir="auto"
      class="note-title font-bold text-muted-foreground leading-snug"
    >{title || $t('notes.untitled')}</h1>
  {:else}
    <!-- No dir="auto" here: the global `unicode-bidi: plaintext` on text fields
         already makes the title follow what the user types, and an empty title
         then follows the UI instead of falling back to LTR. -->
    <textarea
      bind:this={textareaEl}
      value={title}
      oninput={handleInput}
      placeholder={$t('notes.untitled')}
      rows={1}
      class="w-full resize-none overflow-hidden bg-transparent note-title font-bold
           leading-snug placeholder:text-muted-foreground/50 focus:outline-none"
      aria-label={$t('notes.note_title_label')}
    ></textarea>
  {/if}

  <!-- Metadata rows -->
  <div class="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
    {#if folderName}
      <div class="flex items-center gap-2">
        <Folder class="h-3.5 w-3.5 shrink-0" />
        <button
          type="button"
          class="min-w-0 truncate rounded px-1 py-0.5 text-start transition-colors
             hover:bg-accent hover:text-accent-foreground"
          onclick={onfolderclick}
        >
          <bdi>{folderName}</bdi>
        </button>
      </div>
    {/if}

    {#if !activeTrash}
      <div class="flex items-center gap-2">
        <Tag class="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div class="min-w-0 flex-1">
          <TagPicker {noteId} />
        </div>
      </div>
    {/if}

    {#if !activeTrash && colorKey}
      <div class="flex items-center gap-2">
        <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          <span class="h-2.5 w-2.5 rounded-full {APPEARANCE_SWATCH_CLASS[colorKey]}"></span>
        </span>
        <button
          type="button"
          class="min-w-0 truncate rounded px-1 py-0.5 text-start transition-colors
             hover:bg-accent hover:text-accent-foreground"
          aria-label={$t('notes.color.row_label', { values: { color: colorName } })}
          onclick={oncolorclick}
        >
          {colorName}
        </button>
      </div>
    {/if}

    {#if formattedCreatedAt}
      <div class="flex items-center gap-2">
        <Calendar class="h-3.5 w-3.5 shrink-0" />
        <span class="text-xs">{$t('metadata.created')} {formattedCreatedAt}</span>
      </div>
    {/if}

    {#if formattedUpdatedAt}
      <div class="flex items-center gap-2">
        <Calendar class="h-3.5 w-3.5 shrink-0" />
        <span class="text-xs">{$t('metadata.edited')} {formattedUpdatedAt}</span>
      </div>
    {/if}
  </div>
  </div>
</div>

<style>
  /* Note title: 1.5rem (text-2xl) on mobile, 1.25rem (text-xl) from md, times
     the note text size of this device (--rn-note-scale on <html>, 1 by
     default), so the title grows with the note body (editor and preview scale
     the same way). */
  .note-title {
    font-size: calc(1.5rem * var(--rn-note-scale, 1));
  }
  @media (min-width: 768px) {
    .note-title {
      font-size: calc(1.25rem * var(--rn-note-scale, 1));
    }
  }
</style>
