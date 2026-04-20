<script lang="ts">
  import { Pencil, Palette, Trash2 } from '@lucide/svelte';
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { tagManager } from '$lib/services/tag-manager.svelte';

  let {
    ondelete
  }: {
    ondelete: (tagId: string) => void;
  } = $props();

  const activeMenuTag = $derived(
    tagManager.tagMenuId ? ($tagsStore.find((t) => t.id === tagManager.tagMenuId) ?? null) : null
  );
</script>

<Sheet bind:open={tagManager.tagActionSheetOpen}>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader>
      <SheetTitle>{activeMenuTag?.name ?? ''}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() =>
          activeMenuTag &&
          tagManager.startRenameTag(activeMenuTag.id, activeMenuTag.name)}
      >
        <Pencil class="mr-2 h-4 w-4" />
        {$t('tags.rename')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start"
        onclick={() =>
          activeMenuTag && tagManager.startColorPicker(activeMenuTag.id)}
      >
        <Palette class="mr-2 h-4 w-4" />
        {$t('tags.tag_color')}
      </Button>
      <Button
        variant="ghost"
        class="w-full justify-start text-destructive hover:text-destructive"
        onclick={() => tagManager.tagMenuId && ondelete(tagManager.tagMenuId)}
      >
        <Trash2 class="mr-2 h-4 w-4" />
        {$t('tags.delete_tag')}
      </Button>
    </div>
  </SheetContent>
</Sheet>
