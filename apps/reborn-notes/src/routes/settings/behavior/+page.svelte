<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Switch,
    toast
  } from '@reborn/ui';
  import { ChevronDown, Eye, FolderInput, House, Pencil, Trash2 } from '@lucide/svelte';
  import {
    appSettings,
    confirmBeforeDelete as confirmBeforeDeleteStore,
    editorMode as editorModeStore,
    newNoteFolderId as newNoteFolderIdStore
  } from '$lib/stores/app-settings.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import { flattenFolderTree } from '$lib/utils/folder-helpers';
  import FolderGlyph from '$lib/components/folders/FolderGlyph.svelte';
  import MoveToFolderMenu from '$lib/components/notes/MoveToFolderMenu.svelte';
  import type { EditorMode } from '@reborn/storage';
  import {
    devicePrefs,
    noteOpenMode as noteOpenModeStore,
    startPage as startPageStore,
    isStartPage,
    START_PAGES,
    type NoteOpenMode,
    type StartPage
  } from '$lib/stores/device-prefs.store';
  import { t } from '$lib/stores/i18n.store';
  import { createLogger } from '@reborn/utils';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';

  const logger = createLogger('behavior-settings');
  const isMobile = useIsMobile();

  let startPageValue = $state<StartPage>('all');
  let openModeValue = $state<NoteOpenMode>('preview');

  // The rail sections reuse their navigation names, so the choice reads exactly
  // like the button it opens.
  function startPageLabel(page: StartPage): string {
    switch (page) {
      case 'starred':
        return $t('nav.starred');
      case 'folders':
        return $t('nav.folders');
      case 'tags':
        return $t('nav.tags');
      case 'last':
        return $t('settings_page.behavior.start_page_last');
      default:
        return $t('nav.all_notes');
    }
  }

  function updateStartPage(value: string | undefined) {
    if (!isStartPage(value)) return;
    devicePrefs.setStartPage(value);
    startPageValue = value;
    toast.success($t('settings_page.behavior.start_page_updated'));
  }
  let editorModeValue = $state<EditorMode>('markdown');
  let confirmDeleteValue = $state(true);

  // Folder for new notes (#522). A folder deleted since reads as "No folder",
  // which is also what "New note" does with it.
  let folderPickerOpen = $state(false);
  const newNoteFolder = $derived(
    $newNoteFolderIdStore === null
      ? null
      : (flattenFolderTree($foldersStore).find((f) => f.id === $newNoteFolderIdStore) ?? null)
  );

  async function updateNewNoteFolder(folderId: string | null) {
    try {
      await appSettings.update('newNoteFolderId', folderId);
      toast.success($t('settings_page.behavior.new_note_folder_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update the folder for new notes', err);
    }
  }

  // Split is a desktop layout (editor + preview side by side). On phones the app
  // collapses it to plain edit, so don't offer it as a choice on this device.
  const openModeOptions = $derived<readonly NoteOpenMode[]>(
    isMobile.value ? ['preview', 'edit'] : ['preview', 'edit', 'split']
  );

  function openModeLabel(mode: NoteOpenMode): string {
    return mode === 'edit'
      ? $t('settings_page.behavior.open_mode_edit')
      : mode === 'split'
        ? $t('settings_page.behavior.open_mode_split')
        : $t('settings_page.behavior.open_mode_preview');
  }

  function updateOpenMode(value: string | undefined) {
    if (value !== 'preview' && value !== 'edit' && value !== 'split') return;
    devicePrefs.setNoteOpenMode(value);
    openModeValue = value;
    toast.success($t('settings_page.behavior.open_mode_updated'));
  }

  async function updateEditorMode(value: string | undefined) {
    if (value !== 'markdown' && value !== 'live') return;
    try {
      await appSettings.update('editorMode', value);
      editorModeValue = value;
      toast.success($t('settings_page.behavior.editor_mode_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update editor mode', err);
    }
  }

  async function updateConfirmDelete(value: boolean) {
    try {
      await appSettings.update('confirmBeforeDelete', value);
      confirmDeleteValue = value;
      toast.success($t('settings_page.behavior.confirm_delete_updated'));
    } catch (err: unknown) {
      logger.error('Failed to update delete confirmation', err);
    }
  }

  onMount(() => {
    const unsubscribes = [
      startPageStore.subscribe((v) => (startPageValue = v)),
      noteOpenModeStore.subscribe((v) => (openModeValue = v)),
      editorModeStore.subscribe((v) => (editorModeValue = v)),
      confirmBeforeDeleteStore.subscribe((v) => (confirmDeleteValue = v))
    ];
    return () => unsubscribes.forEach((fn) => fn());
  });
</script>

<svelte:head>
  <title>{$t('settings_page.behavior.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('settings_page.behavior.title')} backHref="/settings">
  <div class="space-y-6 px-4 sm:px-0">
    <!-- Start page (per-device, localStorage - not synced; issue #511) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <House class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.start_page')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.start_page_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select
          type="single"
          value={startPageValue}
          onValueChange={(value) => updateStartPage(value)}
        >
          <SelectTrigger class="w-full">
            {startPageLabel(startPageValue)}
          </SelectTrigger>
          <SelectContent>
            {#each START_PAGES as page (page)}
              <SelectItem value={page}>{startPageLabel(page)}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
        {#if startPageValue === 'last'}
          <p class="text-xs text-muted-foreground">
            {$t('settings_page.behavior.start_page_last_hint')}
          </p>
        {/if}
        <!-- Same wording as the open-mode card below, so the shared key. -->
        <p class="text-xs text-muted-foreground">
          {$t('settings_page.behavior.open_mode_device_hint')}
        </p>
      </CardContent>
    </Card>

    <!-- Folder for new notes (synced in the notes app bundle; issue #522) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <FolderInput class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.new_note_folder')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.new_note_folder_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          onclick={() => (folderPickerOpen = true)}
          aria-haspopup="dialog"
          class="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 shadow-xs flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px]"
        >
          <span class="flex min-w-0 items-center gap-2">
            {#if newNoteFolder}
              <FolderGlyph
                color={newNoteFolder.color}
                icon={newNoteFolder.icon}
                class="h-4 w-4 shrink-0 text-muted-foreground"
              />
              <span class="truncate"><bdi>{newNoteFolder.name}</bdi></span>
            {:else}
              <span class="truncate text-muted-foreground">{$t('notes.no_folder')}</span>
            {/if}
          </span>
          <ChevronDown class="size-4 shrink-0 opacity-50" />
        </button>
      </CardContent>
    </Card>

    <!-- Default open mode (per-device, localStorage - not synced) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Eye class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.open_mode')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.open_mode_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select type="single" value={openModeValue} onValueChange={(value) => updateOpenMode(value)}>
          <SelectTrigger class="w-full">
            {openModeLabel(openModeValue)}
          </SelectTrigger>
          <SelectContent>
            {#each openModeOptions as mode (mode)}
              <SelectItem value={mode}>{openModeLabel(mode)}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
        <p class="text-xs text-muted-foreground">
          {$t('settings_page.behavior.open_mode_device_hint')}
        </p>
      </CardContent>
    </Card>

    <!-- Editor mode (synced across devices) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Pencil class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.editor_mode')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.editor_mode_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <Select
          type="single"
          value={editorModeValue}
          onValueChange={(value) => updateEditorMode(value)}
        >
          <SelectTrigger class="w-full">
            {editorModeValue === 'live'
              ? $t('settings_page.behavior.editor_mode_live')
              : $t('settings_page.behavior.editor_mode_markdown')}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="markdown"
              >{$t('settings_page.behavior.editor_mode_markdown')}</SelectItem
            >
            <SelectItem value="live">{$t('settings_page.behavior.editor_mode_live')}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>

    <!-- Confirm before deleting (synced across devices) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Trash2 class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.behavior.confirm_delete')}
        </CardTitle>
        <CardDescription>{$t('settings_page.behavior.confirm_delete_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-muted-foreground">
            {confirmDeleteValue
              ? $t('settings_page.behavior.confirm_delete_on')
              : $t('settings_page.behavior.confirm_delete_off')}
          </span>
          <Switch
            checked={confirmDeleteValue}
            onCheckedChange={(v: boolean) => updateConfirmDelete(v)}
          />
        </div>
      </CardContent>
    </Card>
  </div>
</SettingsLayout>

<MoveToFolderMenu
  selection={{
    kind: 'single',
    id: 'new-note-folder',
    currentFolderId: newNoteFolder?.id ?? null
  }}
  bind:open={folderPickerOpen}
  forceSheet
  mode="choose"
  title={$t('settings_page.behavior.new_note_folder')}
  onmove={(folderId) => updateNewNoteFolder(folderId)}
/>
