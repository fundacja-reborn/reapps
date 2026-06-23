<script lang="ts">
  import {
    Pencil,
    Columns2,
    Eye,
    Clock,
    Waypoints,
    ListTree,
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
  import EditorModeButton from './EditorModeButton.svelte';
  import NoteShareIndicator from '../notes/NoteShareIndicator.svelte';
  import type { Snippet } from 'svelte';

  type ViewMode = 'edit' | 'split' | 'preview';
  type HistoryMode = 'closed' | 'list' | 'diff';

  let {
    isMobile,
    activeTrash,
    // eslint-disable-next-line no-useless-assignment -- $bindable prop default (set by parent via bind:), not dead
    viewMode = $bindable('edit'),
    effectiveViewMode,
    historyMode = $bindable<HistoryMode>('closed'),
    linkedNotesActive = false,
    ontogglelinkednotes,
    outlineActive = false,
    ontoggleoutline,
    onback,
    onshowxray,
    onrestore,
    onpermanentdelete,
    onhistoryreset,
    actions,
    title = '',
    showTitle = false,
    noteId = null,
    onShareCreate
  }: {
    isMobile: boolean;
    activeTrash: boolean;
    viewMode: ViewMode;
    effectiveViewMode: ViewMode;
    historyMode: HistoryMode;
    /** Whether the Linked notes panel is open (drives the toggle's pressed state). */
    linkedNotesActive?: boolean;
    /** Toggle the Linked notes panel (desktop only - mobile uses the kebab menu). */
    ontogglelinkednotes?: () => void;
    /** Whether the Outline panel is open (drives the toggle's pressed state). */
    outlineActive?: boolean;
    /** Toggle the Outline panel (desktop only - mobile uses the kebab menu). */
    ontoggleoutline?: () => void;
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
    /** Source note id — drives the per-note share indicator. */
    noteId?: string | null;
    /** Wired to the parent's create-share flow so the indicator can launch it. */
    onShareCreate?: () => void;
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

<!-- pt + min-h grow together by the iOS notch inset so the content keeps its
     full row box and stays vertically centered (env() is 0 elsewhere). -->
<header
  class="flex min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] md:min-h-[calc(3rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 border-b border-border/60
    pt-[env(safe-area-inset-top,0px)]
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

  <!-- Active share indicator (only when this note has live shares) -->
  {#if !activeTrash}
    <NoteShareIndicator {noteId} onCreateNew={onShareCreate} />
  {/if}

  <!-- E2EE indicator (flat) -->
  <button
    type="button"
    onclick={onshowxray}
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
         transition-colors hover:bg-accent hover:text-accent-foreground"
    title={$t('e2e.badge_tooltip')}
    aria-label={$t('e2e.badge_tooltip')}
  >
    <Lock class="h-4 w-4" />
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
          {#if mode === 'edit'}
            <EditorModeButton
              viewMode={effectiveViewMode}
              {isMobile}
              {label}
              onActivate={() => {
                viewMode = 'edit';
              }}
            />
          {:else}
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
        {/if}
      {/each}
    </div>

    <!-- Outline toggle (desktop only - on mobile it's in kebab menu) -->
    {#if !isMobile && ontoggleoutline}
      <button
        type="button"
        onclick={ontoggleoutline}
        title={$t('outline.title')}
        aria-label={$t('outline.title')}
        aria-pressed={outlineActive}
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
           transition-colors hover:bg-accent hover:text-accent-foreground
           {outlineActive ? 'bg-accent text-accent-foreground' : ''}"
      >
        <ListTree class="h-4 w-4" />
      </button>
    {/if}

    <!-- Linked notes toggle (desktop only - on mobile it's in kebab menu) -->
    {#if !isMobile && ontogglelinkednotes}
      <button
        type="button"
        onclick={ontogglelinkednotes}
        title={$t('linked_notes.title')}
        aria-label={$t('linked_notes.title')}
        aria-pressed={linkedNotesActive}
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
           transition-colors hover:bg-accent hover:text-accent-foreground
           {linkedNotesActive ? 'bg-accent text-accent-foreground' : ''}"
      >
        <Waypoints class="h-4 w-4" />
      </button>
    {/if}

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
        {$t('notes.delete_permanently')}
      {/if}
    </button>
  {/if}

  <!-- Kebab menu (NoteDetailActions) -->
  {#if actions}
    {@render actions()}
  {/if}
</header>
