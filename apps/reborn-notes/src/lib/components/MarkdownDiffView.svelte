<script lang="ts">
  import { computeLineDiff, computeDiffStats, type DiffLine } from '$lib/utils/markdown-diff';
  import { t } from '$lib/stores/i18n.store';

  let {
    oldText,
    newText
  }: {
    oldText: string;
    newText: string;
  } = $props();

  const diffLines = $derived(computeLineDiff(oldText, newText));
  const stats = $derived(computeDiffStats(diffLines));
  const hasChanges = $derived(stats.additions > 0 || stats.deletions > 0);
</script>

{#if !hasChanges}
  <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
    {$t('history.no_changes')}
  </div>
{:else}
  <div class="flex flex-col h-full">
    <!-- Stats bar -->
    <div class="flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-xs text-muted-foreground">
      <span class="text-green-600 dark:text-green-400">
        +{$t('history.additions', { values: { count: stats.additions } })}
      </span>
      <span class="text-red-600 dark:text-red-400">
        -{$t('history.deletions', { values: { count: stats.deletions } })}
      </span>
    </div>

    <!-- Diff content -->
    <div class="flex-1 overflow-auto">
      <pre class="min-w-0 text-xs leading-5 font-mono">{#each diffLines as line, i (i)}{@render diffLine(line, i)}{/each}</pre>
    </div>
  </div>
{/if}

{#snippet diffLine(line: DiffLine, _i: number)}
  {#if line.status === 'added'}
    <div class="bg-green-100 text-green-900 dark:bg-green-950/40 dark:text-green-200 px-4">
      <span class="inline-block w-6 select-none text-right text-green-600/60 dark:text-green-400/60 mr-2">+</span>{#if line.words}{#each line.words as word, wi (wi)}{#if word.added}<span class="bg-green-200 dark:bg-green-800/60 rounded-sm">{word.value}</span>{:else}{word.value}{/if}{/each}{:else}{line.value}{/if}
    </div>
  {:else if line.status === 'removed'}
    <div class="bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 px-4">
      <span class="inline-block w-6 select-none text-right text-red-600/60 dark:text-red-400/60 mr-2">-</span>{#if line.words}{#each line.words as word, wi (wi)}{#if word.removed}<span class="bg-red-200 dark:bg-red-800/60 rounded-sm">{word.value}</span>{:else}{word.value}{/if}{/each}{:else}{line.value}{/if}
    </div>
  {:else}
    <div class="px-4 text-foreground/80">
      <span class="inline-block w-6 select-none text-right text-muted-foreground/40 mr-2">&nbsp;</span>{line.value}
    </div>
  {/if}
{/snippet}
