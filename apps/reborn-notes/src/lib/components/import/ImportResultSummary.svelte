<script lang="ts">
  import { t } from '$lib/stores/i18n.store';
  import type {
    ImportFolderResult,
    ImportMarkdownResult
  } from '$lib/services/export-import.service';

  let {
    result,
    class: className = ''
  }: {
    result: ImportMarkdownResult | ImportFolderResult;
    class?: string;
  } = $props();

  // Folder imports carry extra counters (created folders/tags, skip buckets).
  // Field presence is the discriminator - no separate `kind` prop to drift.
  const folderResult = $derived('foldersCreated' in result ? result : null);
</script>

<div
  class="rounded-md px-3 py-2 text-xs space-y-1 {className}
  {result.errors.length === 0
    ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'}"
>
  {#if result.imported > 0}
    <p>
      {#if folderResult}
        {$t('settings_page.export_import.folder_import_summary', {
          values: {
            imported: folderResult.imported,
            folders: folderResult.foldersCreated,
            tags: folderResult.tagsCreated
          }
        })}
      {:else}
        {$t('settings_page.export_import.imported_count', {
          values: { count: result.imported }
        })}
      {/if}
    </p>
  {/if}
  {#if folderResult}
    {#if folderResult.skippedHidden > 0}
      <p class="text-muted-foreground">
        {$t('settings_page.export_import.folder_import_skipped_hidden', {
          values: { count: folderResult.skippedHidden }
        })}
      </p>
    {/if}
    {#if folderResult.skippedNonMarkdown > 0}
      <p class="text-muted-foreground">
        {$t('settings_page.export_import.folder_import_skipped_non_md', {
          values: { count: folderResult.skippedNonMarkdown }
        })}
      </p>
    {/if}
    {#if folderResult.skippedTooLarge > 0}
      <p class="text-muted-foreground">
        {$t('settings_page.export_import.folder_import_skipped_too_large', {
          values: { count: folderResult.skippedTooLarge }
        })}
      </p>
    {/if}
  {/if}
  {#if result.duplicatesOverwritten > 0}
    <p class="text-muted-foreground">
      {$t('settings_page.export_import.dedup_count_overwritten', {
        values: { count: result.duplicatesOverwritten }
      })}
    </p>
  {/if}
  {#if result.duplicatesRenamed > 0}
    <p class="text-muted-foreground">
      {$t('settings_page.export_import.dedup_count_renamed', {
        values: { count: result.duplicatesRenamed }
      })}
    </p>
  {/if}
  {#if result.duplicatesSkipped > 0}
    <p class="text-muted-foreground">
      {$t('settings_page.export_import.dedup_count_skipped', {
        values: { count: result.duplicatesSkipped }
      })}
    </p>
  {/if}
  {#if result.duplicatesUnchanged > 0}
    <p class="text-muted-foreground">
      {$t('settings_page.export_import.dedup_count_unchanged', {
        values: { count: result.duplicatesUnchanged }
      })}
    </p>
  {/if}
  {#if result.strippedCount > 0}
    <p>
      {$t('settings_page.export_import.unsafe_content_stripped', {
        values: { count: result.strippedCount }
      })}
    </p>
  {/if}
  {#each result.errors as err}
    <p>{err}</p>
  {/each}
</div>
