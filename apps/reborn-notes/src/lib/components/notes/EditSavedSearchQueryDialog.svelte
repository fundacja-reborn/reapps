<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    toastStore
  } from '@reborn/ui';
  import { MAX_SAVED_SEARCH_QUERY_CHARS } from '@reborn/types';
  import type { SavedSearchDecrypted } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';
  import { savedSearchesStore } from '$lib/stores/saved-searches.store';

  let {
    open = $bindable(false),
    search
  }: {
    open: boolean;
    /** The saved search whose query is being edited. */
    search: SavedSearchDecrypted | null;
  } = $props();

  let query = $state('');
  let searchInContent = $state(false);
  let queryInputEl = $state<HTMLTextAreaElement | null>(null);
  let isSaving = $state(false);

  // Re-seed the fields from the target every time the dialog opens - the same
  // component instance is reused across rows, so stale values must not leak in.
  $effect(() => {
    if (open && search) {
      query = search.query;
      searchInContent = search.search_in_content;
      setTimeout(() => queryInputEl?.focus(), 0);
    }
  });

  const canSave = $derived(query.trim().length > 0);

  async function handleSave() {
    if (!canSave || isSaving || !search) return;
    isSaving = true;
    try {
      await savedSearchesStore.updateQuery(search.id, query.trim(), searchInContent);
      toastStore.success(
        $t('saved_searches.query_updated_toast', { values: { name: search.name } })
      );
      open = false;
    } catch {
      toastStore.error($t('saved_searches.query_update_failed_toast'));
    } finally {
      isSaving = false;
    }
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$t('saved_searches.edit_dialog.title')}</DialogTitle>
      <DialogDescription>{$t('saved_searches.edit_dialog.description')}</DialogDescription>
    </DialogHeader>

    <div class="flex flex-col gap-3 py-2">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium">{$t('saved_searches.dialog.query_label')}</span>
        <!-- Textarea (not a single-line input): queries can run long with several
             operators, and wrapping keeps the whole query readable while editing.
             Cmd/Ctrl+Enter saves so a bare Enter can still insert a newline. -->
        <textarea
          bind:this={queryInputEl}
          bind:value={query}
          rows="2"
          maxlength={MAX_SAVED_SEARCH_QUERY_CHARS}
          class="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          onkeydown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
          }}
        ></textarea>
      </label>
      <label class="flex cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" bind:checked={searchInContent} class="h-4 w-4 accent-primary" />
        {$t('notes.search_in_content')}
      </label>
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
