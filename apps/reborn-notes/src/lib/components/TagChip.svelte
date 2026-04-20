<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { TagDecrypted } from '@reborn/types';
  import { t } from '$lib/stores/i18n.store';

  let {
    tag,
    onremove,
    size = 'sm'
  }: {
    tag: TagDecrypted;
    onremove?: () => void;
    size?: 'xs' | 'sm';
  } = $props();
</script>

<span
  class="inline-flex items-center gap-1 rounded-full font-medium
    {size === 'xs' ? 'px-2 py-0.5 text-[13px] md:px-1.5 md:text-xs' : 'px-2 py-0.5 text-xs'}"
  style={tag.color
    ? `background-color: color-mix(in oklch, ${tag.color} var(--tag-mix, 13%), transparent); color: color-mix(in oklch, ${tag.color} var(--tag-fg-mix, 100%), white); border: 1px solid color-mix(in oklch, ${tag.color} var(--tag-border-mix, 33%), transparent);`
    : ''}
  class:bg-accent={!tag.color}
  class:text-accent-foreground={!tag.color}
  class:border={!tag.color}
>
  <span class="max-w-[6rem] truncate">{tag.name}</span>
  {#if onremove}
    <button
      type="button"
      onclick={(e) => {
        e.stopPropagation();
        onremove?.();
      }}
      class="flex items-center justify-center shrink-0 opacity-60 hover:opacity-100
        {size === 'xs' ? 'min-h-5 min-w-5 -mr-0.5 -my-0.5' : 'min-h-7 min-w-7 -mr-1'}"
      aria-label={$t('tags.remove_tag_name', { values: { name: tag.name } })}
    >
      <X class={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    </button>
  {/if}
</span>
