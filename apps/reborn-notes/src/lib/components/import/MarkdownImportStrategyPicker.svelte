<script lang="ts">
  import { t } from '$lib/stores/i18n.store';
  import type { DuplicateStrategy } from '$lib/services/import-dedup-utils';

  let {
    count,
    strategy = $bindable<DuplicateStrategy>('rename'),
    promptVariant = 'root',
    radioGroupName = 'md-strategy'
  }: {
    count: number;
    strategy?: DuplicateStrategy;
    // 'root'   — files land in "All notes" (Settings → Import .md)
    // 'folder' — files land in a specific folder (folder context, vault import)
    promptVariant?: 'root' | 'folder';
    radioGroupName?: string;
  } = $props();

  const promptKey = $derived(
    promptVariant === 'folder'
      ? 'settings_page.export_import.dedup_prompt_folder'
      : 'settings_page.export_import.dedup_prompt_root'
  );
</script>

<div class="space-y-3">
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
</div>
