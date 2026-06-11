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

  let {
    open = $bindable(false),
    query,
    searchInContent = false
  }: {
    open: boolean;
    /** The query string currently in the search bar - saved verbatim. */
    query: string;
    /** Current state of the body-search toggle - saved with the view and restored on apply. */
    searchInContent?: boolean;
  } = $props();

  let name = $state('');
  let nameInputEl = $state<HTMLInputElement | null>(null);
  let isSaving = $state(false);

  $effect(() => {
    if (open) {
      name = '';
      setTimeout(() => nameInputEl?.focus(), 0);
    }
  });

  const canSave = $derived(name.trim().length > 0 && query.trim().length > 0);

  async function handleSave() {
    if (!canSave || isSaving) return;
    isSaving = true;
    try {
      await savedSearchesStore.create(name, query, searchInContent);
      toastStore.success($t('saved_searches.saved_toast', { values: { name: name.trim() } }));
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
        <code
          class="block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        >
          {query}
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
