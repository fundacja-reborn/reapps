<script lang="ts">
  import {
    Pencil,
    Columns2,
    Eye,
    Clock,
    ArrowLeft,
    Lock,
    Loader2,
    CheckCircle2,
    PenLine,
    RotateCcw,
    Trash2,
    AlertTriangle
  } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import type { Snippet } from 'svelte';

  type ViewMode = 'edit' | 'split' | 'preview';
  type HistoryMode = 'closed' | 'list' | 'diff';

  let {
    isMobile,
    activeTrash,
    viewMode = $bindable('edit'),
    effectiveViewMode,
    historyMode = $bindable<HistoryMode>('closed'),
    onback,
    onshowxray,
    onrestore,
    onpermanentdelete,
    onhistoryreset,
    actions,
    title = '',
    showTitle = false
  }: {
    isMobile: boolean;
    activeTrash: boolean;
    viewMode: ViewMode;
    effectiveViewMode: ViewMode;
    historyMode: HistoryMode;
    onback: () => void;
    onshowxray: () => void;
    onrestore: () => void;
    onpermanentdelete: () => void;
    onhistoryreset: () => void;
    /** Slot for NoteDetailActions (kebab menu) */
    actions?: Snippet;
    /** Note title (shown small when large title scrolls out of view) */
    title?: string;
    /** Whether to show small title in header (when large title scrolled away) */
    showTitle?: boolean;
  } = $props();

  const VIEW_MODES: { mode: ViewMode; label: string; icon: typeof Pencil }[] = $derived([
    { mode: 'edit', label: $t('view_mode.edit'), icon: Pencil },
    { mode: 'split', label: $t('view_mode.split'), icon: Columns2 },
    { mode: 'preview', label: $t('view_mode.preview'), icon: Eye }
  ]);

  /** Show size indicator when note exceeds 80% of limit. */
  const sizePercent = $derived(
    noteDetailService.contentLimitBytes > 0
      ? (noteDetailService.contentSize / noteDetailService.contentLimitBytes) * 100
      : 0
  );
  const showSizeIndicator = $derived(sizePercent >= 80);

  function formatKB(bytes: number): string {
    return `${Math.round(bytes / 1024)} KB`;
  }
</script>

<header
  class="flex h-14 md:h-12 shrink-0 items-center gap-2 border-b border-border/60
    {isMobile ? 'px-3' : 'px-6'}"
>
  <button
    type="button"
    onclick={onback}
    class="flex shrink-0 items-center justify-center rounded-md text-foreground
       hover:bg-accent transition-colors -ml-1
       {isMobile ? 'h-11 w-11' : 'h-8 w-8'}"
    aria-label={$t('nav.back')}
  >
    <ArrowLeft class={isMobile ? 'h-5 w-5' : 'h-4 w-4'} />
  </button>

  <!-- Small title (shown when large title scrolls out of view) -->
  {#if title}
    <span
      class="min-w-0 truncate text-sm font-medium text-foreground transition-opacity duration-200
        {showTitle ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
    >{title}</span>
  {/if}

  <!-- Spacer pushes everything to the right -->
  <div class="flex-1"></div>

  {#if !activeTrash}
    <!-- Save status indicator (before E2EE to avoid layout shift) -->
    {#if noteDetailService.saveStatus === 'over_limit'}
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center text-destructive"
        title={$t('notes.errors.size_limit_exceeded', {
          max: formatKB(noteDetailService.contentLimitBytes)
        })}
      >
        <AlertTriangle class="h-4 w-4" />
      </span>
    {:else if noteDetailService.saveStatus === 'dirty'}
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center text-amber-500 dark:text-amber-400"
        title={$t('save_status.unsaved')}
      >
        <PenLine class="h-4 w-4" />
      </span>
    {:else if noteDetailService.saveStatus === 'saving'}
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground"
        title={$t('save_status.saving')}
      >
        <Loader2 class="h-4 w-4 animate-spin" />
      </span>
    {:else if noteDetailService.saveStatus === 'saved'}
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center text-green-600 dark:text-green-400"
        title={$t('save_status.saved')}
      >
        <CheckCircle2 class="h-4 w-4" />
      </span>
    {/if}

    <!-- Size indicator (visible when ≥ 80% of limit) -->
    {#if showSizeIndicator}
      <span
        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums
          {noteDetailService.isOverLimit
          ? 'bg-destructive/10 text-destructive'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}"
        title={$t('notes.size_warning')}
      >
        {formatKB(noteDetailService.contentSize)} / {formatKB(noteDetailService.contentLimitBytes)}
      </span>
    {/if}
  {/if}

  <!-- E2EE badge -->
  <button
    type="button"
    onclick={onshowxray}
    class="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/50
         px-2 py-0.5 text-xs text-muted-foreground select-none
         transition-colors hover:bg-muted hover:text-foreground
         {!isMobile ? 'animate-[pulse_2s_ease-in-out_1]' : ''}"
    style={!isMobile ? 'animation-delay: 1.5s; animation-fill-mode: backwards;' : undefined}
    title={$t('e2e.badge_tooltip')}
  >
    <Lock class="h-3.5 w-3.5 md:h-3 md:w-3" />
    <span class="hidden lg:inline">{$t('e2e.badge')}</span>
    <span class="{isMobile ? '' : 'hidden sm:inline'} lg:hidden">{$t('e2e.badge_short')}</span>
  </button>

  {#if !activeTrash}
    <!-- View mode toggles -->
    <div
      class="flex items-center gap-0.5 rounded-md border p-0.5"
      role="group"
      aria-label={$t('view_mode.label')}
    >
      {#each VIEW_MODES as { mode, label, icon: Icon } (mode)}
        {#if !isMobile || mode !== 'split'}
          {@const isActive = effectiveViewMode === mode}
          <button
            type="button"
            onclick={() => {
              viewMode = mode;
            }}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            class="flex h-8 md:h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors
              {isActive
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'}
              {!isMobile && mode === 'split' ? 'hidden sm:flex' : 'flex'}"
          >
            <Icon class="h-4 w-4 md:h-3.5 md:w-3.5" />
            {#if !isMobile}
              <span class="hidden sm:inline">{label}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>

    <!-- History toggle (desktop only — on mobile it's in kebab menu) -->
    {#if !isMobile}
      <button
        type="button"
        onclick={() => {
          historyMode = historyMode === 'closed' ? 'list' : 'closed';
          if (historyMode === 'closed') {
            onhistoryreset();
          }
        }}
        title={$t('history.title')}
        aria-label={$t('history.title')}
        aria-pressed={historyMode !== 'closed'}
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
             transition-colors hover:bg-accent hover:text-accent-foreground
             {historyMode !== 'closed' ? 'bg-accent text-accent-foreground' : ''}"
      >
        <Clock class="h-4 w-4" />
      </button>
    {/if}
  {:else}
    <!-- Trash actions -->
    <button
      type="button"
      onclick={onrestore}
      class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium
           transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <RotateCcw class="h-3.5 w-3.5" />
      {$t('notes.restore')}
    </button>
    <button
      type="button"
      onclick={onpermanentdelete}
      class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium
           text-destructive transition-colors hover:bg-destructive/10"
    >
      <Trash2 class="h-3.5 w-3.5" />
      {#if !isMobile}
        {$t('notes.delete')}
      {/if}
    </button>
  {/if}

  <!-- Kebab menu (NoteDetailActions) -->
  {#if actions}
    {@render actions()}
  {/if}
</header>
