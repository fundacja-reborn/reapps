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
  import { Upload, FolderInput } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    importMarkdownFiles,
    importFolder,
    type ImportFolderResult,
    type ImportMarkdownResult
  } from '$lib/services/export-import.service';
  import {
    countImportableMarkdownFiles,
    getRootFolderName
  } from '$lib/services/markdown-import-utils';
  import type { DuplicateStrategy } from '$lib/services/import-dedup-utils';
  import { notesStore } from '$lib/stores/notes.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import MarkdownImportStrategyPicker from './MarkdownImportStrategyPicker.svelte';
  import ImportResultSummary from './ImportResultSummary.svelte';

  let {
    open = $bindable(false),
    files,
    folderId,
    folderName,
    mode = 'files'
  }: {
    open: boolean;
    files: File[] | null;
    folderId: string | null;
    folderName: string;
    // 'files'  - flat .md file picker ("Import .md here")
    // 'folder' - webkitdirectory tree import ("Import folder here")
    mode?: 'files' | 'folder';
  } = $props();

  let strategy = $state<DuplicateStrategy>('rename');
  let keepRootFolder = $state(true);
  // Overwrite-only (folder mode): merge frontmatter tags into existing note
  // tags so in-app curation survives re-imports. Default ON.
  let preserveTags = $state(true);
  let importing = $state(false);
  let result = $state<ImportMarkdownResult | ImportFolderResult | null>(null);

  const rootName = $derived(mode === 'folder' && files ? getRootFolderName(files) : null);
  const importableCount = $derived(
    !files ? 0 : mode === 'folder' ? countImportableMarkdownFiles(files) : files.length
  );
  const destinationPath = $derived(
    keepRootFolder && rootName ? `${folderName}/${rootName}` : folderName
  );

  // Reset internal state every time the dialog closes — the parent decides
  // when to open it again (with fresh files / target).
  $effect(() => {
    if (!open) {
      strategy = 'rename';
      preserveTags = true;
      importing = false;
      result = null;
    }
  });

  // Default for "keep top-level folder", chosen when the dialog opens:
  // ON (mirrors dropping a directory into a folder in a file manager), but
  // OFF when the target folder already carries the picked directory's name -
  // that's a re-import refreshing the folder in place, and "reapps-docs/
  // reapps-docs" is never what the user wants there.
  $effect(() => {
    if (open && mode === 'folder') {
      keepRootFolder =
        !rootName || rootName.toLowerCase() !== folderName.trim().toLowerCase();
    }
  });

  async function runImport() {
    if (!files || !folderId) return;
    importing = true;
    result = null;
    try {
      if (mode === 'folder') {
        const r = await importFolder(files, strategy, undefined, {
          keepRootFolder: keepRootFolder && rootName !== null,
          targetFolderId: folderId,
          tagsOnOverwrite: preserveTags ? 'merge' : 'replace'
        });
        result = r;
        await Promise.all([notesStore.refresh(), foldersStore.refresh(), tagsStore.refresh()]);
      } else {
        const r = await importMarkdownFiles(files, folderId, strategy);
        result = r;
        await Promise.all([notesStore.refresh(), foldersStore.refresh()]);
      }
    } catch (err: unknown) {
      result = {
        imported: 0,
        duplicatesSkipped: 0,
        duplicatesOverwritten: 0,
        duplicatesRenamed: 0,
        duplicatesUnchanged: 0,
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
        {#if mode === 'folder'}
          {$t('folders.import_folder.dialog_title', { values: { name: folderName } })}
        {:else}
          {$t('folders.import_markdown.dialog_title', { values: { name: folderName } })}
        {/if}
      </DialogTitle>
      <DialogDescription>
        {#if mode === 'folder'}
          {$t('folders.import_folder.dialog_description')}
        {:else}
          {$t('folders.import_markdown.dialog_description')}
        {/if}
      </DialogDescription>
    </DialogHeader>

    {#if files && !result}
      <div class="space-y-3">
        <MarkdownImportStrategyPicker
          count={importableCount}
          bind:strategy
          promptVariant="folder"
          radioGroupName="folder-md-import-strategy"
          showPreserveTags={mode === 'folder'}
          bind:preserveTags
        />
        {#if mode === 'folder' && rootName}
          <label class="flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" bind:checked={keepRootFolder} class="mt-0.5" />
            <span>
              <span class="font-medium">
                {$t('settings_page.export_import.keep_root_label', {
                  values: { name: rootName }
                })}
              </span>
              <span class="block text-muted-foreground">
                {$t('settings_page.export_import.keep_root_destination', {
                  values: { path: destinationPath }
                })}
              </span>
            </span>
          </label>
        {/if}
      </div>
    {/if}

    {#if result}
      <ImportResultSummary {result} />
    {/if}

    <DialogFooter>
      {#if !result}
        <Button variant="outline" onclick={close} disabled={importing}>
          {$t('settings_page.export_import.cancel')}
        </Button>
        <Button onclick={runImport} disabled={importing || !files || importableCount === 0}>
          {#if mode === 'folder'}
            <FolderInput class="mr-1.5 h-3.5 w-3.5" />
          {:else}
            <Upload class="mr-1.5 h-3.5 w-3.5" />
          {/if}
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
