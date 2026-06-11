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
  import { toastStore } from '@reborn/ui';
  import { MAX_SAVED_SEARCH_NAME_CHARS } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';
  import { savedSearchesStore } from '$lib/stores/saved-searches.store';
  import { composeScopedQuery, type SaveScope } from '$lib/utils/search-scope';

  let {
    open = $bindable(false),
    query,
    searchInContent = false,
    scope = null,
    inSearchSection = false
  }: {
    open: boolean;
    /** The query string currently in the search bar. */
    query: string;
    /** Current state of the body-search toggle - saved with the view and restored on apply. */
    searchInContent?: boolean;
    /**
     * Scope of the view the user is saving from (folder / tag / starred).
     * Composed into the persisted query as a regular operator so the saved
     * view reproduces the scoped result set the user is looking at.
     */
    scope?: SaveScope | null;
    /** Picks the toast variant: outside the search section, hint where saved views live. */
    inSearchSection?: boolean;
  } = $props();

  let name = $state('');
  let nameInputEl = $state<HTMLInputElement | null>(null);
  let isSaving = $state(false);
  let pinToFolder = $state(false);

  $effect(() => {
    if (open) {
      name = '';
      pinToFolder = false;
      setTimeout(() => nameInputEl?.focus(), 0);
    }
  });

  // What actually gets persisted - shown 1:1 in the preview below.
  const composedQuery = $derived(composeScopedQuery(scope, query));
  const canSave = $derived(name.trim().length > 0 && composedQuery.length > 0);

  async function handleSave() {
    if (!canSave || isSaving) return;
    isSaving = true;
    const trimmedName = name.trim();
    const pinFolderId = scope?.kind === 'folder' && pinToFolder ? scope.folderId : undefined;
    try {
      await savedSearchesStore.create(trimmedName, composedQuery, searchInContent, pinFolderId);
      if (pinFolderId && scope?.kind === 'folder') {
        toastStore.success(
          $t('saved_searches.saved_toast_pinned', {
            values: { name: trimmedName, folder: scope.folderName }
          })
        );
      } else if (!inSearchSection) {
        toastStore.success(
          $t('saved_searches.saved_toast_hint', { values: { name: trimmedName } })
        );
      } else {
        toastStore.success($t('saved_searches.saved_toast', { values: { name: trimmedName } }));
      }
      open = false;
    } catch {
      toastStore.error($t('saved_searches.save_failed_toast'));
    } finally {
      isSaving = false;
    }
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$t('saved_searches.dialog.title')}</DialogTitle>
      <DialogDescription>{$t('saved_searches.dialog.description')}</DialogDescription>
    </DialogHeader>

    <div class="flex flex-col gap-3 py-2">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium">{$t('saved_searches.dialog.name_label')}</span>
        <input
          bind:this={nameInputEl}
          bind:value={name}
          type="text"
          maxlength={MAX_SAVED_SEARCH_NAME_CHARS}
          placeholder={$t('saved_searches.dialog.name_placeholder')}
          class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          onkeydown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
        />
      </label>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-medium">{$t('saved_searches.dialog.query_label')}</span>
        <!-- Multi-line wrap: a single-line nowrap block let long queries push the
             dialog's intrinsic width past the viewport (flex min-width:auto). -->
        <code
          class="block w-full min-w-0 whitespace-pre-wrap break-words rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        >
          {composedQuery}
        </code>
        {#if searchInContent}
          <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              class="inline-flex h-3 w-3 items-center justify-center rounded border border-primary bg-primary text-primary-foreground"
              >✓</span
            >
            {$t('notes.search_in_content')}
          </span>
        {/if}
      </div>
      {#if scope?.kind === 'folder'}
        <label class="flex cursor-pointer items-center gap-2.5 text-sm">
          <input type="checkbox" bind:checked={pinToFolder} class="h-4 w-4 accent-primary" />
          {$t('saved_searches.dialog.pin_to_folder', { values: { name: scope.folderName } })}
        </label>
      {/if}
    </div>

    <DialogFooter>
      <Button variant="outline" onclick={() => (open = false)} disabled={isSaving}>
        {$t('saved_searches.dialog.cancel')}
      </Button>
      <Button onclick={handleSave} disabled={!canSave || isSaving}>
        {$t('saved_searches.dialog.save')}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
