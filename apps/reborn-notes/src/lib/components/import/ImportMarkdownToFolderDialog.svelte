<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button
  } from '@reborn/ui';
  import { Upload } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    importMarkdownFiles,
    type ImportMarkdownResult
  } from '$lib/services/export-import.service';
  import type { DuplicateStrategy } from '$lib/services/import-dedup-utils';
  import { notesStore } from '$lib/stores/notes.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import MarkdownImportStrategyPicker from './MarkdownImportStrategyPicker.svelte';

  let {
    open = $bindable(false),
    files,
    folderId,
    folderName
  }: {
    open: boolean;
    files: File[] | null;
    folderId: string | null;
    folderName: string;
  } = $props();

  let strategy = $state<DuplicateStrategy>('rename');
  let importing = $state(false);
  let result = $state<ImportMarkdownResult | null>(null);

  // Reset internal state every time the dialog closes — the parent decides
  // when to open it again (with fresh files / target).
  $effect(() => {
    if (!open) {
      strategy = 'rename';
      importing = false;
      result = null;
    }
  });

  async function runImport() {
    if (!files || !folderId) return;
    importing = true;
    result = null;
    try {
      const r = await importMarkdownFiles(files, folderId, strategy);
      result = r;
      await Promise.all([notesStore.refresh(), foldersStore.refresh()]);
    } catch (err: unknown) {
      result = {
        imported: 0,
        duplicatesSkipped: 0,
        duplicatesOverwritten: 0,
        duplicatesRenamed: 0,
        strippedCount: 0,
        errors: [err instanceof Error ? err.message : 'Import failed']
      };
    } finally {
      importing = false;
    }
  }

  function close() {
    open = false;
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>
        {$t('folders.import_markdown.dialog_title', { values: { name: folderName } })}
      </DialogTitle>
      <DialogDescription>
        {$t('folders.import_markdown.dialog_description')}
      </DialogDescription>
    </DialogHeader>

    {#if files && !result}
      <MarkdownImportStrategyPicker
        count={files.length}
        bind:strategy
        promptVariant="folder"
        radioGroupName="folder-md-import-strategy"
      />
    {/if}

    {#if result}
      <div
        class="rounded-md px-3 py-2 text-xs space-y-1
        {result.errors.length === 0
          ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'}"
      >
        {#if result.imported > 0}
          <p>
            {$t('settings_page.export_import.imported_count', {
              values: { count: result.imported }
            })}
          </p>
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
    {/if}

    <DialogFooter>
      {#if !result}
        <Button variant="outline" onclick={close} disabled={importing}>
          {$t('settings_page.export_import.cancel')}
        </Button>
        <Button onclick={runImport} disabled={importing || !files || files.length === 0}>
          <Upload class="mr-1.5 h-3.5 w-3.5" />
          {importing
            ? $t('settings_page.export_import.importing')
            : $t('settings_page.export_import.dedup_start')}
        </Button>
      {:else}
        <Button onclick={close}>
          {$t('folders.import_markdown.dialog_close')}
        </Button>
      {/if}
    </DialogFooter>
  </DialogContent>
</Dialog>
