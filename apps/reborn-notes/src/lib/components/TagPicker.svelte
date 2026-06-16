<script lang="ts">
  import { tick } from 'svelte';
  import { Tag, Plus, Check, Palette } from '@lucide/svelte';
  import TagChip from './TagChip.svelte';
  import { tagsStore } from '$lib/stores/tags.store';
  import { notesStore } from '$lib/stores/notes.store';
  import * as TagService from '$lib/services/tag.service';
  import { TAG_COLORS } from '$lib/services/tag.service';
  import { t } from '$lib/stores/i18n.store';

  let { noteId }: { noteId: string } = $props();

  let selectedTagIds = $state<string[]>([]);
  let open = $state(false);
  let query = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let creating = $state(false);
  let newTagColor = $state<(typeof TAG_COLORS)[number]>(TAG_COLORS[4]); // blue default
  let listEl = $state<HTMLDivElement | null>(null);
  // Obsidian-like: target the first match as soon as the user types so Enter
  // confirms it; an empty query targets nothing (-1). Writable derived - arrow-key
  // navigation reassigns it and the value holds until the query changes again.
  let highlightedIndex = $derived(query.trim().length > 0 ? 0 : -1);

  // Load current tags for this note when noteId changes
  $effect(() => {
    loadTagIds(noteId);
  });

  async function loadTagIds(id: string) {
    selectedTagIds = await TagService.getTagIdsForNote(id);
  }

  // Derived: tags currently selected (full objects)
  const selectedTags = $derived($tagsStore.filter((t) => selectedTagIds.includes(t.id)));

  // Derived: filtered list for dropdown (excludes exact match if we're about to create)
  const filteredTags = $derived(
    query
      ? $tagsStore.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
      : $tagsStore
  );

  const hasExactMatch = $derived(
    query.trim().length > 0 &&
      $tagsStore.some((t) => t.name.toLowerCase() === query.trim().toLowerCase())
  );

  // Whether the "create new tag" row is offered (always the last navigable option).
  const showCreate = $derived(query.trim().length > 0 && !hasExactMatch);
  // Navigable options = matching tags + optional create row.
  const optionCount = $derived(filteredTags.length + (showCreate ? 1 : 0));

  // Keep the highlighted option scrolled into view while navigating by keyboard.
  $effect(() => {
    const idx = highlightedIndex;
    if (idx < 0 || !listEl) return;
    listEl.querySelector(`[data-option-index="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  async function openPicker(e?: MouseEvent) {
    e?.stopPropagation(); // prevent window handler from firing before DOM settles
    open = true;
    query = '';
    creating = false;
    await tick();
    inputEl?.focus();
  }

  function closePicker() {
    open = false;
    query = '';
    creating = false;
  }

  async function toggleTag(tagId: string) {
    const newIds = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    await TagService.setTagsForNote(noteId, newIds);
    selectedTagIds = newIds;
    await notesStore.refresh();
    // Clear the field so the next tag starts from a clean input (no carry-over).
    query = '';
    creating = false;
    inputEl?.focus();
  }

  async function removeTag(tagId: string) {
    const newIds = selectedTagIds.filter((id) => id !== tagId);
    await TagService.setTagsForNote(noteId, newIds);
    selectedTagIds = newIds;
    await notesStore.refresh();
  }

  async function createAndAdd() {
    const name = query.trim();
    if (!name) return;
    const id = await tagsStore.create(name, newTagColor);
    const newIds = [...selectedTagIds, id];
    await TagService.setTagsForNote(noteId, newIds);
    selectedTagIds = newIds;
    await notesStore.refresh();
    query = '';
    creating = false;
    inputEl?.focus();
  }

  // Confirm whatever option is currently highlighted (existing tag or create row).
  function selectHighlighted() {
    if (highlightedIndex < 0 || highlightedIndex >= optionCount) return;
    if (highlightedIndex < filteredTags.length) {
      toggleTag(filteredTags[highlightedIndex].id);
    } else if (showCreate) {
      createAndAdd();
    }
  }

  function moveHighlight(delta: number) {
    if (optionCount === 0) return;
    if (highlightedIndex < 0) {
      highlightedIndex = delta > 0 ? 0 : optionCount - 1;
      return;
    }
    highlightedIndex = (highlightedIndex + delta + optionCount) % optionCount;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closePicker();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectHighlighted();
    }
  }
</script>

<svelte:window
  onclick={(e) => {
    if (open && !(e.target as HTMLElement)?.closest('[data-tagpicker]')) {
      closePicker();
    }
  }}
/>

<div class="flex flex-wrap items-center gap-1.5" data-tagpicker>
  <!-- Current tags -->
  {#each selectedTags as tag (tag.id)}
    <TagChip {tag} size="xs" onremove={() => removeTag(tag.id)} />
  {/each}

  <!-- Add tag button / picker -->
  <div class="relative">
    {#if !open}
      <button
        type="button"
        onclick={(e) => openPicker(e)}
        class="flex items-center gap-1 rounded-full border border-dashed px-1.5 py-0.5 text-[10px]
          text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        aria-label={$t('tags.add_tag')}
      >
        <Tag class="h-2.5 w-2.5" />
        <span>{$t('tags.add_tag')}</span>
      </button>
    {:else}
      <!-- Search input -->
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder={$t('tags.search_or_create')}
        onkeydown={handleKeydown}
        class="h-6 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        style="width: 160px"
        aria-label={$t('tags.search_or_create')}
      />

      <!-- Dropdown -->
      <div
        class="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border bg-popover shadow-md"
        role="listbox"
        aria-label={$t('tags.title')}
      >
        <!-- Tag list -->
        {#if filteredTags.length > 0}
          <div bind:this={listEl} class="max-h-48 overflow-y-auto py-1">
            {#each filteredTags as tag, i (tag.id)}
              {@const isSelected = selectedTagIds.includes(tag.id)}
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                class:bg-accent={highlightedIndex === i}
                role="option"
                aria-selected={isSelected}
                data-option-index={i}
                onclick={() => toggleTag(tag.id)}
              >
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  style={tag.color ? `background-color: ${tag.color}` : ''}
                  class:bg-muted-foreground={!tag.color}
                ></span>
                <span class="flex-1 truncate text-left">{tag.name}</span>
                {#if isSelected}
                  <Check class="h-3 w-3 shrink-0 text-primary" />
                {/if}
              </button>
            {/each}
          </div>
        {:else if !query}
          <p class="px-3 py-2 text-xs text-muted-foreground">{$t('tags.no_tags_yet')}</p>
        {/if}

        <!-- Create new tag option -->
        {#if showCreate}
          <div class="border-t">
            {#if !creating}
              <button
                type="button"
                class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                class:bg-accent={highlightedIndex === filteredTags.length}
                onclick={(e) => {
                  e.stopPropagation();
                  creating = true;
                }}
              >
                <Plus class="h-3 w-3 shrink-0 text-primary" />
                <span>{$t('tags.create_named', { values: { name: query.trim() } })}</span>
              </button>
            {:else}
              <!-- Color picker for new tag -->
              <div class="px-3 py-2">
                <p class="mb-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Palette class="h-3 w-3" />
                  {$t('tags.pick_color')}
                </p>
                <div class="flex flex-wrap gap-1">
                  {#each TAG_COLORS as color (color)}
                    <button
                      type="button"
                      class="h-5 w-5 rounded-full transition-transform hover:scale-110
                        {newTagColor === color ? 'ring-2 ring-offset-1 ring-primary' : ''}"
                      style="background-color: {color}"
                      onclick={() => {
                        newTagColor = color;
                      }}
                      aria-label={$t('tags.color_label', { values: { color: color as string } })}
                    ></button>
                  {/each}
                </div>
                <button
                  type="button"
                  class="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                  onclick={createAndAdd}
                >
                  <Plus class="h-3 w-3" />
                  {$t('tags.create_named', { values: { name: query.trim() } })}
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
