<script lang="ts">
  import { t } from '$lib/stores/i18n.store';
  import type { DuplicateStrategy } from '$lib/services/import-dedup-utils';

  let {
    count,
    strategy = $bindable<DuplicateStrategy>('rename'),
    promptVariant = 'root',
    radioGroupName = 'md-strategy',
    showPreserveTags = false,
    preserveTags = $bindable(true),
    showRewriteLinks = false,
    rewriteLinks = $bindable(false)
  }: {
    count: number;
    strategy?: DuplicateStrategy;
    // 'root'   — files land in "All notes" (Settings → Import .md)
    // 'folder' — files land in a specific folder (folder context, vault import)
    promptVariant?: 'root' | 'folder';
    radioGroupName?: string;
    // Folder imports only (the flat .md path never manages tags): offers the
    // "keep tags added in the app" choice for the overwrite strategy.
    // Rendered only while `overwrite` is selected - it has no effect otherwise.
    showPreserveTags?: boolean;
    preserveTags?: boolean;
    // Folder imports only: offers converting relative `.md` links between the
    // imported files into internal note links. Applies to every strategy, so
    // (unlike preserveTags) it is not gated on the selected option. Default off.
    showRewriteLinks?: boolean;
    rewriteLinks?: boolean;
  } = $props();

  const promptKey = $derived(
    promptVariant === 'folder'
      ? 'settings_page.export_import.dedup_prompt_folder'
      : 'settings_page.export_import.dedup_prompt_root'
  );

  let containerEl: HTMLDivElement | null = $state(null);

  // The picker is rendered conditionally by the parent right after the user
  // closes the OS file/folder picker. Long settings pages can leave the radio
  // options below the viewport, so we scroll the picker into view and move
  // focus to the first (currently-selected) radio. `preventScroll: true` on
  // focus avoids fighting the scrollIntoView animation.
  $effect(() => {
    if (!containerEl) return;
    containerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => {
      const firstRadio = containerEl?.querySelector<HTMLInputElement>('input[type="radio"]');
      firstRadio?.focus({ preventScroll: true });
    });
  });
</script>

<div bind:this={containerEl} class="space-y-3">
  <p class="text-xs font-medium">
    {$t('settings_page.export_import.dedup_files_found', { values: { count } })}
  </p>
  <p class="text-xs text-muted-foreground">
    {$t(promptKey)}
  </p>
  <div class="space-y-2">
    {#each ['rename', 'skip', 'overwrite'] as opt (opt)}
      <label class="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="radio"
          name={radioGroupName}
          value={opt}
          bind:group={strategy}
          class="mt-0.5"
        />
        <span>
          <span class="font-medium">
            {$t(`settings_page.export_import.dedup_${opt}`)}
          </span>
          <span class="block text-muted-foreground">
            {$t(`settings_page.export_import.dedup_${opt}_desc`)}
          </span>
        </span>
      </label>
    {/each}
  </div>
  {#if showPreserveTags && strategy === 'overwrite'}
    <label class="ml-5 flex items-start gap-2 text-xs cursor-pointer">
      <input type="checkbox" bind:checked={preserveTags} class="mt-0.5" />
      <span>
        <span class="font-medium">
          {$t('settings_page.export_import.preserve_tags_label')}
        </span>
        <span class="block text-muted-foreground">
          {$t('settings_page.export_import.preserve_tags_desc')}
        </span>
      </span>
    </label>
  {/if}
  {#if showRewriteLinks}
    <label class="flex items-start gap-2 text-xs cursor-pointer">
      <input type="checkbox" bind:checked={rewriteLinks} class="mt-0.5" />
      <span>
        <span class="font-medium">
          {$t('settings_page.export_import.rewrite_links_label')}
        </span>
        <span class="block text-muted-foreground">
          {$t('settings_page.export_import.rewrite_links_desc')}
        </span>
      </span>
    </label>
  {/if}
</div>
