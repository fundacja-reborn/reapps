<script lang="ts">
  import {
    MoreVertical,
    FilePlus,
    FolderPlus,
    FolderInput,
    Pencil,
    RefreshCw,
    Trash2,
    Upload
  } from '@lucide/svelte';
  import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    toastStore
  } from '@reborn/ui';
  import type { FolderWithChildren } from '@reborn/types';
  import { foldersStore } from '$lib/stores/folders.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { syncedFolderConfigs, runFolderSync } from '$lib/services/folder-sync.service';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import type { DeleteFolderMode } from '$lib/services/folder.service';
  import DeleteFolderDialog from './DeleteFolderDialog.svelte';
  import ImportMarkdownToFolderDialog from '$lib/components/import/ImportMarkdownToFolderDialog.svelte';

  let {
    folder,
    buttonClass = 'h-9 w-9',
    iconClass = 'h-4 w-4',
    align = 'end',
    onNewNote,
    onNewSubfolder,
    onStartRename,
    onAfterDelete
  }: {
    folder: FolderWithChildren | null;
    buttonClass?: string;
    iconClass?: string;
    align?: 'end' | 'start' | 'center';
    /** Shows "New note in this folder" item only when provided. */
    onNewNote?: () => void;
    /** Shows "New subfolder" item only when provided. */
    onNewSubfolder?: () => void;
    /** Parent owns the rename UI (e.g. inline input). */
    onStartRename: () => void;
    /** Called after a successful delete — parent can navigate back to parent folder. */
    onAfterDelete?: () => void;
  } = $props();

  const isMobileQuery = useIsMobile();

  // Sync link is by folder id, so this follows a rename and needs no
  // top-level/name gate. Null when the folder isn't a sync destination ->
  // the "Sync now" entry stays hidden.
  const syncConfigId = $derived(
    folder ? ($syncedFolderConfigs.get(folder.id) ?? null) : null
  );
  let syncing = $state(false);

  async function handleSyncNow() {
    sheetOpen = false;
    if (!syncConfigId || syncing) return;
    syncing = true;
    try {
      await runFolderSync('manual', syncConfigId);
      toastStore.success($t('folders.sync_done'));
    } finally {
      syncing = false;
    }
  }

  let sheetOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let importDialogOpen = $state(false);
  let importMode = $state<'files' | 'folder'>('files');
  let importPendingFiles = $state<File[] | null>(null);
  let importFileInputEl = $state<HTMLInputElement | null>(null);
  let importFolderInputEl = $state<HTMLInputElement | null>(null);

  function openSheet() {
    sheetOpen = true;
  }

  function handleNewNote() {
    sheetOpen = false;
    onNewNote?.();
  }

  function handleNewSubfolder() {
    sheetOpen = false;
    onNewSubfolder?.();
  }

  function handleStartRename() {
    sheetOpen = false;
    onStartRename();
  }

  function handleImportHere() {
    sheetOpen = false;
    importMode = 'files';
    if (importFileInputEl) importFileInputEl.value = '';
    importFileInputEl?.click();
  }

  function handleImportFolderHere() {
    sheetOpen = false;
    importMode = 'folder';
    if (importFolderInputEl) importFolderInputEl.value = '';
    importFolderInputEl?.click();
  }

  // Shared by both hidden inputs - `importMode` was set by the trigger.
  function handleImportFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    importPendingFiles = files;
    importDialogOpen = true;
  }

  $effect(() => {
    if (!importDialogOpen) importPendingFiles = null;
  });

  function handleDelete() {
    sheetOpen = false;
    deleteDialogOpen = true;
  }

  async function confirmDeleteFolder(mode: DeleteFolderMode) {
    if (!folder) return;
    await foldersStore.remove(folder.id, mode);
    if (mode === 'cascade') notesStore.refresh();
    onAfterDelete?.();
  }
</script>

{#if folder}
  {#if isMobileQuery.value}
    <button
      type="button"
      onclick={openSheet}
      class="flex {buttonClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label={$t('folders.folder_actions')}
      title={$t('folders.folder_actions')}
    >
      <MoreVertical class={iconClass} />
    </button>
  {:else}
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="flex {buttonClass} shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={$t('folders.folder_actions')}
            title={$t('folders.folder_actions')}
          >
            <MoreVertical class={iconClass} />
          </button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent {align} class="min-w-44">
        {#if syncConfigId}
          <DropdownMenuItem onclick={handleSyncNow}>
            <RefreshCw class="h-3.5 w-3.5" />
            {$t('folders.sync_now')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        {/if}
        {#if onNewNote}
          <DropdownMenuItem onclick={handleNewNote}>
            <FilePlus class="h-3.5 w-3.5" />
            {$t('folders.new_note_here')}
          </DropdownMenuItem>
        {/if}
        {#if onNewSubfolder}
          <DropdownMenuItem onclick={handleNewSubfolder}>
            <FolderPlus class="h-3.5 w-3.5" />
            {$t('folders.new_subfolder')}
          </DropdownMenuItem>
        {/if}
        <DropdownMenuItem onclick={handleStartRename}>
          <Pencil class="h-3.5 w-3.5" />
          {$t('folders.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onclick={handleImportHere}>
          <Upload class="h-3.5 w-3.5" />
          {$t('folders.import_markdown.action')}
        </DropdownMenuItem>
        <DropdownMenuItem onclick={handleImportFolderHere}>
          <FolderInput class="h-3.5 w-3.5" />
          {$t('folders.import_folder.action')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          class="text-destructive focus:text-destructive"
          onclick={handleDelete}
        >
          <Trash2 class="h-3.5 w-3.5" />
          {$t('folders.delete_folder')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  {/if}
{/if}

<!-- Mobile bottom sheet -->
<Sheet bind:open={sheetOpen}>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader>
      <SheetTitle>{folder?.name ?? ''}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      {#if syncConfigId}
        <Button variant="ghost" class="w-full justify-start" onclick={handleSyncNow}>
          <RefreshCw class="mr-2 h-4 w-4" />
          {$t('folders.sync_now')}
        </Button>
      {/if}
      {#if onNewNote}
        <Button variant="ghost" class="w-full justify-start" onclick={handleNewNote}>
          <FilePlus class="mr-2 h-4 w-4" />
          {$t('folders.new_note_here')}
        </Button>
      {/if}
      {#if onNewSubfolder}
        <Button variant="ghost" class="w-full justify-start" onclick={handleNewSubfolder}>
          <FolderPlus class="mr-2 h-4 w-4" />
          {$t('folders.new_subfolder')}
        </Button>
      {/if}
      <Button variant="ghost" class="w-full justify-start" onclick={handleStartRename}>
        <Pencil class="mr-2 h-4 w-4" />
        {$t('folders.rename')}
      </Button>
      <Button variant="ghost" class="w-full justify-start" onclick={handleImportHere}>
        <Upload class="mr-2 h-4 w-4" />
        {$t('folders.import_markdown.action')}
      </Button>
      <Button variant="ghost" class="w-full justify-start" onclick={handleImportFolderHere}>
        <FolderInput class="mr-2 h-4 w-4" />
        {$t('folders.import_folder.action')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start text-destructive hover:text-destructive"
        onclick={handleDelete}
      >
        <Trash2 class="mr-2 h-4 w-4" />
        {$t('folders.delete_folder')}
      </Button>
    </div>
  </SheetContent>
</Sheet>

<DeleteFolderDialog
  bind:open={deleteDialogOpen}
  folderId={folder?.id ?? null}
  folderName={folder?.name ?? ''}
  onConfirm={confirmDeleteFolder}
/>

<!-- Hidden file inputs for "Import .md here" / "Import folder here" - triggered from the menu -->
<input
  bind:this={importFileInputEl}
  type="file"
  accept=".md,text/markdown"
  multiple
  class="hidden"
  onchange={handleImportFilesSelected}
/>
<input
  bind:this={importFolderInputEl}
  type="file"
  webkitdirectory
  multiple
  class="hidden"
  onchange={handleImportFilesSelected}
/>

<ImportMarkdownToFolderDialog
  bind:open={importDialogOpen}
  files={importPendingFiles}
  folderId={folder?.id ?? null}
  folderName={folder?.name ?? ''}
  mode={importMode}
/>
