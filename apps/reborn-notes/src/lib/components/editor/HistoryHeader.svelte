<script lang="ts">
  import { Eye, Clock, ArrowLeft, X, RotateCcw, FileDiff, ChevronRight } from '@lucide/svelte';
  import { SidebarTrigger } from '@reborn/ui/sidebar';
  import { t } from '$lib/stores/i18n.store';

  type HistoryViewMode = 'preview' | 'diff';

  let {
    isMobile,
    selectedVersion,
    previousVersion,
    isLatestVersion,
    historyViewMode = $bindable<HistoryViewMode>('preview'),
    onback,
    onclose,
    onrestore,
    onshowlist
  }: {
    isMobile: boolean;
    selectedVersion: import('@reborn/types').NoteHistoryDecrypted;
    previousVersion: import('@reborn/types').NoteHistoryDecrypted | null;
    isLatestVersion: boolean;
    historyViewMode: HistoryViewMode;
    onback?: () => void;
    onclose: () => void;
    onrestore: () => void;
    onshowlist: () => void;
  } = $props();
</script>

<!-- Row 1: back/title + toggle -->
<!-- pt + min-h grow together by the iOS notch inset so the content keeps its
     full 3rem box (env() is 0 elsewhere) -->
<header
  class="flex min-h-[calc(3rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 border-b border-border/60
    pt-[env(safe-area-inset-top,0px)]
    {isMobile ? 'px-3' : 'px-6'}"
>
  {#if isMobile}
    <button
      type="button"
      onclick={onback}
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground
         hover:bg-accent transition-colors -ml-1"
      aria-label={$t('nav.back')}
    >
      <ArrowLeft class="h-4 w-4" />
    </button>
  {:else}
    <SidebarTrigger class="md:hidden -ml-1 shrink-0" />
  {/if}
  <span class="min-w-0 flex-1 truncate text-sm font-medium"
    >{selectedVersion.title || $t('notes.untitled')}</span
  >
  {#if previousVersion}
    <div class="flex h-7 shrink-0 items-center rounded-md border text-xs">
      <button
        type="button"
        onclick={() => {
          historyViewMode = 'preview';
        }}
        class="flex h-full items-center gap-1 rounded-l-md px-2 transition-colors
             {historyViewMode === 'preview'
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50'}"
        aria-pressed={historyViewMode === 'preview'}
      >
        <Eye class="h-3 w-3" />
        {$t('history.preview')}
      </button>
      <button
        type="button"
        onclick={() => {
          historyViewMode = 'diff';
        }}
        class="flex h-full items-center gap-1 rounded-r-md px-2 transition-colors
             {historyViewMode === 'diff'
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50'}"
        aria-pressed={historyViewMode === 'diff'}
      >
        <FileDiff class="h-3 w-3" />
        {$t('history.show_diff')}
      </button>
    </div>
  {/if}
</header>

<!-- Row 2: version date -->
<div
  class="flex shrink-0 items-center gap-2 border-b py-1.5
    {isMobile ? 'px-4' : 'px-6'}"
>
  <Clock class="h-3.5 w-3.5 text-muted-foreground" />
  <span class="text-xs text-muted-foreground">
    {$t('history.version_date', {
      values: {
        date: new Date(selectedVersion.created_at).toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    })}
    {#if isLatestVersion}
      — {$t('history.current_version')}
    {/if}
  </span>
</div>

<!-- Row 3: actions -->
<div
  class="flex shrink-0 items-center gap-2 border-b py-1.5
    {isMobile ? 'px-3' : 'px-6'}"
>
  <button
    type="button"
    onclick={onclose}
    class="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground
         transition-colors hover:bg-accent hover:text-accent-foreground"
    aria-label={$t('history.close_history')}
  >
    <X class="h-3.5 w-3.5" />
    {$t('history.close_history')}
  </button>
  <div class="flex-1"></div>
  <button
    type="button"
    onclick={onrestore}
    disabled={isLatestVersion}
    class="flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium
         text-primary-foreground transition-colors hover:bg-primary/90
         disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
  >
    <RotateCcw class="h-3 w-3" />
    {$t('history.restore_version')}
  </button>
  <button
    type="button"
    onclick={onshowlist}
    class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground
         transition-colors hover:bg-accent hover:text-accent-foreground"
  >
    {$t('history.version_list')}
    <ChevronRight class="h-3.5 w-3.5" />
  </button>
</div>
