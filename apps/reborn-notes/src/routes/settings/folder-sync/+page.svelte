<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
  } from '@reborn/ui';
  import { FolderOpen, FolderPlus, AlertTriangle } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    folderSyncStatus,
    isFolderSyncSupported,
    pickFolderToLink,
    addLinkedFolder,
    runFolderSync,
    refreshFolderSyncStatus,
    MAX_FOLDER_SYNC_CONFIGS
  } from '$lib/services/folder-sync.service';
  import type { ImportFolderResult } from '$lib/services/export-import.service';
  import FolderSyncItem from '$lib/components/import/FolderSyncItem.svelte';
  import ImportResultSummary from '$lib/components/import/ImportResultSummary.svelte';

  const supported = isFolderSyncSupported();

  // Add-folder flow: the picker returns a handle, then a small form collects
  // the display name (defaults to the directory name) before the config is
  // created - the name is fixed afterwards (rename = unlink + relink).
  let pendingHandle = $state<FileSystemDirectoryHandle | null>(null);
  let pendingName = $state('');
  let nameTaken = $state(false);
  let adding = $state(false);
  // Errors of the PICK step (shown near the add button, no form open).
  let pickError = $state<'already-linked' | 'limit-reached' | null>(null);
  let alreadyLinkedName = $state('');
  // Result panel for the initial import of the most recently added folder.
  let addResult = $state<ImportFolderResult | null>(null);

  const statuses = $derived($folderSyncStatus);
  const anyBusy = $derived(statuses.some((s) => s.state === 'syncing'));
  const atLimit = $derived(statuses.length >= MAX_FOLDER_SYNC_CONFIGS);

  onMount(() => {
    if (supported) void refreshFolderSyncStatus();
  });

  async function handlePick() {
    pickError = null;
    addResult = null;
    const outcome = await pickFolderToLink();
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'limit-reached') {
      pickError = 'limit-reached';
      return;
    }
    if (outcome.kind === 'already-linked') {
      pickError = 'already-linked';
      alreadyLinkedName = outcome.name;
      return;
    }
    pendingHandle = outcome.handle;
    pendingName = outcome.handle.name;
    nameTaken = false;
  }

  function cancelAdd() {
    pendingHandle = null;
    pendingName = '';
    nameTaken = false;
  }

  async function confirmAdd(e: Event) {
    e.preventDefault();
    if (!pendingHandle || !pendingName.trim()) return;
    adding = true;
    nameTaken = false;
    try {
      const added = await addLinkedFolder(pendingHandle, pendingName);
      if (!added.ok) {
        if (added.error === 'name-taken') nameTaken = true;
        else if (added.error === 'limit-reached') {
          cancelAdd();
          pickError = 'limit-reached';
        }
        return;
      }
      cancelAdd();
      // Initial full import - progress streams into the new list item; the
      // detailed summary lands in the page-level result panel below.
      addResult = await runFolderSync('manual', added.id);
    } finally {
      adding = false;
    }
  }
</script>

<svelte:head>
  <title>{$t('settings_page.export_import.folder_sync_title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('settings_page.export_import.folder_sync_title')} backHref="/settings">
  <div class="space-y-6 px-4 sm:px-0">
    <Card>
      <CardHeader>
        <CardTitle class="text-base">
          {$t('settings_page.export_import.folder_sync_title')}
        </CardTitle>
        <CardDescription>
          {$t('settings_page.export_import.folder_sync_desc')}
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if !supported}
          <p class="rounded-md border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            {$t('settings_page.export_import.folder_sync_unsupported')}
          </p>
        {:else}
          {#each statuses as status (status.id)}
            <FolderSyncItem {status} disabled={anyBusy || adding} />
          {:else}
            <p class="text-sm text-muted-foreground">
              {$t('settings_page.export_import.folder_sync_empty')}
            </p>
          {/each}

          {#if pendingHandle}
            <form
              onsubmit={confirmAdd}
              class="space-y-3 rounded-lg border border-primary/40 bg-muted/30 p-4"
            >
              <p class="text-xs text-muted-foreground">
                {$t('settings_page.export_import.folder_sync_picked_dir', {
                  values: { name: pendingHandle.name }
                })}
              </p>
              <div class="space-y-1">
                <label class="text-xs font-medium" for="folder-sync-name">
                  {$t('settings_page.export_import.folder_sync_name_label')}
                </label>
                <input
                  id="folder-sync-name"
                  type="text"
                  bind:value={pendingName}
                  oninput={() => (nameTaken = false)}
                  disabled={adding}
                  maxlength="120"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.folder_sync_name_desc')}
                </p>
              </div>
              {#if nameTaken}
                <p class="text-xs text-destructive">
                  {$t('settings_page.export_import.folder_sync_name_taken')}
                </p>
              {/if}
              <div class="flex gap-2">
                <button
                  type="submit"
                  disabled={adding || !pendingName.trim()}
                  class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <FolderPlus class="h-3.5 w-3.5" />
                  {$t('settings_page.export_import.folder_sync_confirm_add_btn')}
                </button>
                <button
                  type="button"
                  onclick={cancelAdd}
                  disabled={adding}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {$t('settings_page.export_import.cancel')}
                </button>
              </div>
            </form>
          {:else}
            <div class="space-y-2">
              <button
                type="button"
                onclick={handlePick}
                disabled={anyBusy || adding || atLimit}
                class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
              >
                <FolderOpen class="h-3.5 w-3.5" />
                {$t('settings_page.export_import.folder_sync_add_btn')}
              </button>
              {#if atLimit || pickError === 'limit-reached'}
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.folder_sync_limit_hint', {
                    values: { max: MAX_FOLDER_SYNC_CONFIGS }
                  })}
                </p>
              {/if}
              {#if pickError === 'already-linked'}
                <div
                  class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2"
                >
                  <AlertTriangle
                    class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
                  />
                  <p class="text-xs text-amber-700 dark:text-amber-400">
                    {$t('settings_page.export_import.folder_sync_already_linked', {
                      values: { name: alreadyLinkedName }
                    })}
                  </p>
                </div>
              {/if}
            </div>
          {/if}

          {#if addResult}
            <ImportResultSummary result={addResult} />
          {/if}

          <div class="space-y-1 border-t pt-3">
            <p class="text-xs text-muted-foreground">
              {$t('settings_page.export_import.folder_sync_safety_note')}
            </p>
            <p class="text-[11px] text-muted-foreground/70">
              {$t('settings_page.export_import.folder_sync_no_full_path')}
            </p>
          </div>
        {/if}
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
