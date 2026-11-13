<script lang="ts">
  import { MoreVertical } from '@lucide/svelte';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
  } from '@reborn/ui';
  import type { FolderWithChildren } from '@reborn/types';
  import { syncedFolderConfigs } from '$lib/services/folder-sync.service';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { buildFolderActions } from '$lib/utils/folder-actions';
  import type { RowAction } from '$lib/utils/row-action';
  import FolderActionDialogs from '$lib/components/folders/FolderActionDialogs.svelte';
  import RowActionSheet from '$lib/components/shared/RowActionSheet.svelte';

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
    /** Called after a successful delete or archive - parent can navigate back to parent folder. */
    onAfterDelete?: () => void;
  } = $props();

  const isMobileQuery = useIsMobile();

  // Dialogs behind the menu items (color and icon, move, delete, import) and
  // the actions without UI (archive, sync now).
  let dialogs = $state<FolderActionDialogs | undefined>(undefined);
  let sheetOpen = $state(false);

  // Sync link is by folder id, so this follows a rename and needs no
  // top-level/name gate. Null when the folder isn't a sync destination ->
  // the "Sync now" entry stays hidden.
  const syncConfigId = $derived(
    folder ? ($syncedFolderConfigs.get(folder.id) ?? null) : null
  );

  // The phone sheet opens the draft within the tap, so its input gets the
  // keyboard (the draft's flushSync closes the sheet's focus trap first).
  // The dropdown (wider screens) runs the item's click while the menu is
  // still open: its focus trap would pull the focus back from the draft
  // input, and the blur would commit the default name. There the draft opens
  // once the menu has closed and returned the focus to its trigger. A tablet
  // on this path may still need a tap on the field for its keyboard; the
  // header's "New subfolder" button opens it straight away.
  function handleNewSubfolder() {
    if (isMobileQuery.value) onNewSubfolder?.();
    else setTimeout(() => onNewSubfolder?.(), 0);
  }

  // The same list as a folder row's menu (`buildFolderActions`), minus what
  // only a row has (sibling reorder). `undecryptable: 'full'`: this menu
  // keeps "New note here" / "New subfolder" for a folder whose name could not
  // be decrypted, because on a narrow phone the header buttons are hidden.
  const actions = $derived.by<RowAction[]>(() => {
    const target = folder;
    if (!target) return [];
    return buildFolderActions(
      target,
      {
        syncNow: () => {
          if (syncConfigId) void dialogs?.syncNow(syncConfigId);
        },
        newNote: onNewNote ? () => onNewNote() : undefined,
        newSubfolder: onNewSubfolder ? handleNewSubfolder : undefined,
        rename: () => onStartRename(),
        appearance: () => dialogs?.openAppearance(target),
        move: () => dialogs?.requestMove(target),
        importFiles: () => dialogs?.importFiles(target),
        importFolder: () => dialogs?.importFolder(target),
        // The folder leaves the everyday tree, so the parent navigates away
        // like after a delete (`onAfterRemove` below).
        archive: () => void dialogs?.archive(target),
        remove: () => dialogs?.requestDelete(target)
      },
      { t: $t, syncConfigId, undecryptable: 'full' }
    );
  });
</script>

{#if folder}
  {#if isMobileQuery.value}
    <button
      type="button"
      onclick={() => (sheetOpen = true)}
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
        {#each actions as { key, icon: Icon, label, run, destructive, separatorBefore } (key)}
          {#if separatorBefore}
            <DropdownMenuSeparator />
          {/if}
          <DropdownMenuItem
            class={destructive ? 'text-destructive focus:text-destructive' : ''}
            onclick={run}
          >
            <Icon class="h-3.5 w-3.5" />
            {label}
          </DropdownMenuItem>
        {/each}
      </DropdownMenuContent>
    </DropdownMenu>
  {/if}
{/if}

<!-- Phone: the same actions in a bottom sheet -->
<RowActionSheet bind:open={sheetOpen} title={folder?.name ?? ''} {actions} />

<FolderActionDialogs bind:this={dialogs} onAfterRemove={() => onAfterDelete?.()} />
