<script lang="ts">
  import { tick } from 'svelte';
  import { Folder, Tag, Calendar } from '@lucide/svelte';
  import TagPicker from '$lib/components/TagPicker.svelte';
  import { t, locale } from '$lib/stores/i18n.store';

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
    ontitleinput,
    onfolderclick
  }: {
    isMobile: boolean;
    activeTrash: boolean;
    title: string;
    folderName: string | null;
    noteId: string;
    updatedAt: string | null;
    createdAt: string | null;
    effectiveViewMode?: ViewMode;
    ontitleinput: (e: Event) => void;
    onfolderclick: () => void;
  } = $props();

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
      const currentLocale = $locale || 'en';
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
      class="text-2xl md:text-xl font-bold text-muted-foreground leading-snug"
    >{title || $t('notes.untitled')}</h1>
  {:else}
    <textarea
      bind:this={textareaEl}
      value={title}
      oninput={handleInput}
      placeholder={$t('notes.untitled')}
      rows={1}
      class="w-full resize-none overflow-hidden bg-transparent text-2xl md:text-xl font-bold
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
          class="min-w-0 truncate rounded px-1 py-0.5 text-left transition-colors
             hover:bg-accent hover:text-accent-foreground"
          onclick={onfolderclick}
        >
          {folderName}
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
