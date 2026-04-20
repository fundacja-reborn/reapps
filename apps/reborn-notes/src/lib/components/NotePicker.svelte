<script lang="ts">
  import { Search, FileText, X } from '@lucide/svelte';
  import * as Dialog from '@reborn/ui/components/dialog';
  import { t } from '$lib/stores/i18n.store';

  interface NoteItem {
    id: string;
    title: string;
  }

  let {
    open = $bindable(false),
    notes = [],
    excludeNoteId,
    onselect
  }: {
    open?: boolean;
    /** Lightweight title entries from TitleIndex cache */
    notes: NoteItem[];
    /** Exclude the currently edited note */
    excludeNoteId?: string | null;
    onselect?: (noteId: string, title: string) => void;
  } = $props();

  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);

  const filteredNotes = $derived(() => {
    const available = notes.filter((n) => n.id !== excludeNoteId);
    if (!searchQuery.trim()) return available;
    const q = searchQuery.toLowerCase();
    return available.filter((n) => n.title.toLowerCase().includes(q));
  });

  function handleSelect(note: NoteItem) {
    const title = note.title || $t('notes.untitled');
    onselect?.(note.id, title);
    open = false;
    searchQuery = '';
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    if (!isOpen) {
      searchQuery = '';
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-md gap-0 p-0">
    <Dialog.Header class="border-b px-4 py-3">
      <Dialog.Title class="text-sm font-medium">{$t('editor.formatting.note_link')}</Dialog.Title>
    </Dialog.Header>

    <!-- Search input -->
    <div class="border-b px-3 py-2">
      <div class="relative">
        <Search
          class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          bind:this={searchInputEl}
          type="search"
          placeholder={$t('notes.search_placeholder')}
          bind:value={searchQuery}
          class="w-full rounded-md border bg-background py-1.5 pl-7 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {#if searchQuery}
          <button
            type="button"
            onclick={() => {
              searchQuery = '';
              searchInputEl?.focus();
            }}
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X class="h-3 w-3" />
          </button>
        {/if}
      </div>
    </div>

    <!-- Note list -->
    <div class="max-h-64 overflow-y-auto py-1">
      {#if filteredNotes().length === 0}
        <div class="px-4 py-6 text-center text-sm text-muted-foreground">
          {$t('notes.no_notes_short')}
        </div>
      {:else}
        {#each filteredNotes() as note (note.id)}
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors hover:bg-accent"
            onclick={() => handleSelect(note)}
          >
            <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-normal text-foreground">
                {note.title || $t('notes.untitled')}
              </p>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
