<script lang="ts">
  import { X } from '@lucide/svelte';
  import { TAG_COLORS } from '$lib/services/tag.service';
  import { t } from '$lib/stores/i18n.store';

  let {
    tagId,
    currentColor,
    onsetcolor
  }: {
    tagId: string;
    currentColor: string | undefined;
    onsetcolor: (tagId: string, color: string | undefined) => void;
  } = $props();
</script>

<div
  class="flex flex-wrap items-center gap-1.5 rounded-md bg-accent/50 px-2 py-1.5"
  data-tagcolorpicker
>
  {#each TAG_COLORS as color (color)}
    <button
      type="button"
      class="h-5 w-5 shrink-0 rounded-full transition-transform hover:scale-110
        {currentColor === color ? 'ring-2 ring-offset-1 ring-primary' : ''}"
      style="background-color: {color}"
      onclick={() => onsetcolor(tagId, color)}
      aria-label={$t('tags.color_label', { values: { color } })}
    ></button>
  {/each}
  <button
    type="button"
    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed
      transition-transform hover:scale-110
      {!currentColor ? 'ring-2 ring-offset-1 ring-primary' : ''}"
    onclick={() => onsetcolor(tagId, undefined)}
    aria-label={$t('tags.no_color')}
  >
    <X class="h-2.5 w-2.5 text-muted-foreground" />
  </button>
</div>
