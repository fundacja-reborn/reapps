<script lang="ts">
  import { X, MoreHorizontal } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { tagManager } from '$lib/services/tag-manager.svelte';
  import TagColorPicker from './TagColorPicker.svelte';

  let {
    activeTagId,
    onselect,
    mobileNewTagInput = $bindable(null)
  }: {
    activeTagId: string | null;
    onselect: (tagId: string) => void;
    mobileNewTagInput?: HTMLInputElement | null;
  } = $props();

  const filteredTags = $derived(
    tagManager.tagSearch
      ? $tagsStore.filter((t) => t.name.toLowerCase().includes(tagManager.tagSearch.toLowerCase()))
      : $tagsStore
  );
</script>

<div class="flex flex-col overflow-hidden h-full">
  {#if !tagManager.creatingTag}
    <div class="px-3 pt-2 pb-1">
      <div class="relative">
        <input
          type="text"
          placeholder={$t('tags.search_placeholder')}
          bind:value={tagManager.tagSearch}
          class="h-8 w-full rounded-md border bg-background px-2.5 text-xs
             placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {#if tagManager.tagSearch}
          <button
            type="button"
            onclick={() => {
              tagManager.tagSearch = '';
            }}
            class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={$t('notes.clear_search')}
          >
            <X class="h-3.5 w-3.5" />
          </button>
        {/if}
      </div>
    </div>
  {/if}
  {#if tagManager.creatingTag}
    <div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
      <input
        type="text"
        placeholder={$t('tags.tag_name')}
        bind:value={tagManager.newTagName}
        bind:this={mobileNewTagInput}
        onkeydown={(e) => {
          if (e.key === 'Enter') tagManager.handleCreateTag();
          if (e.key === 'Escape') {
            tagManager.creatingTag = false;
            tagManager.newTagName = '';
          }
        }}
        class="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs
           placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onclick={() => tagManager.handleCreateTag()}
        disabled={!tagManager.newTagName.trim()}
        class="flex h-7 shrink-0 items-center rounded-md bg-primary px-2.5 text-xs font-medium
           text-primary-foreground transition-colors hover:bg-primary/90
           disabled:pointer-events-none disabled:opacity-50"
      >
        {$t('tags.add_tag')}
      </button>
    </div>
  {/if}
  <div class="flex-1 overflow-y-auto px-2 py-2">
    {#if $tagsStore.length === 0}
      <p class="px-2 py-1 text-xs text-muted-foreground">{$t('tags.no_tags_yet')}</p>
    {:else if filteredTags.length === 0}
      <p class="px-2 py-1 text-xs text-muted-foreground">{$t('tags.no_matching')}</p>
    {:else}
      {#each filteredTags as tag (tag.id)}
        <div class="group relative flex items-center">
          {#if tagManager.renamingTagId === tag.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={tagManager.renameTagInputEl}
              type="text"
              bind:value={tagManager.renameTagValue}
              autofocus
              class="w-full rounded-md border bg-background px-2 py-1.5 text-sm caret-primary focus:outline-none focus:ring-1 focus:ring-primary"
              onkeydown={(e) => {
                if (e.key === 'Enter') tagManager.commitRenameTag(tag.id);
                if (e.key === 'Escape') {
                  tagManager.renamingTagId = null;
                }
              }}
              onblur={() => tagManager.commitRenameTag(tag.id)}
            />
          {:else}
            <button
              type="button"
              onclick={() => onselect(tag.id)}
              class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors
                {activeTagId === tag.id
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60'}"
            >
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full"
                style={tag.color ? `background-color: ${tag.color}` : ''}
                class:bg-muted-foreground={!tag.color}
              ></span>
              <span class="min-w-0 flex-1 truncate text-left text-sm">{tag.name}</span>
            </button>
            <button
              type="button"
              class="absolute right-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground
                transition-opacity hover:bg-accent hover:text-foreground"
              onclick={(e) => tagManager.openTagMenu(tag.id, true, e)}
              aria-label={$t('tags.tag_actions')}
              tabindex="-1"
            >
              <MoreHorizontal class="h-3.5 w-3.5" />
            </button>
          {/if}
        </div>

        {#if tagManager.colorPickerTagId === tag.id}
          <TagColorPicker
            tagId={tag.id}
            currentColor={tag.color}
            onsetcolor={(id, color) => tagManager.setTagColor(id, color)}
          />
        {/if}
      {/each}
    {/if}
  </div>
</div>
