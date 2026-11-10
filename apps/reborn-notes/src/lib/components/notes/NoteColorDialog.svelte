<script lang="ts">
  import { untrack } from 'svelte';
  import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    toastStore
  } from '@reborn/ui';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { noteColorDialog } from '$lib/stores/note-color-dialog.svelte';
  import { notesStore } from '$lib/stores/notes.store';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { APPEARANCE_SWATCH_CLASS, isAppearanceColor } from '$lib/utils/appearance-colors';
  import AppearanceColorGroup from '../AppearanceColorGroup.svelte';

  /**
   * Color mark picker for one note or a multi-selection. Mounted once on the
   * main page and driven by `noteColorDialog` (see note-color-dialog.svelte.ts).
   * Desktop: centered dialog; mobile: bottom sheet - like the folder
   * appearance dialog, whose swatch group it shares.
   *
   * A choice applies right away (no Save step) and the list behind updates
   * live. Writes are debounced so arrowing across the palette does not run an
   * encrypt + sync cycle per swatch; closing flushes. Nothing is written
   * unless the user picks a color, so opening the dialog never overwrites a
   * key this build does not know, nor a mixed selection.
   */

  const isMobileQuery = useIsMobile();

  const SAVE_DEBOUNCE_MS = 300;

  let color = $state<string | undefined>(undefined);
  // Several notes with different colors: nothing is checked until a pick.
  let mixed = $state(false);
  // Notes this opening applies to - a snapshot, so a selection change behind
  // the dialog cannot redirect a pending write.
  let targetIds = $state<string[]>([]);

  // Plain (non-reactive) bookkeeping: read and written only from handlers.
  let seededKey: string | null = null;
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveChain: Promise<void> = Promise.resolve();

  // Seed once per opening (not on every index refresh - the refresh after our
  // own write would fight a choice still in flight). Closing, or reopening for
  // other notes, flushes the pending write of the notes it was seeded for.
  $effect(() => {
    const ids = noteColorDialog.open ? noteColorDialog.noteIds : [];
    const key = ids.length > 0 ? ids.join(',') : null;
    untrack(() => {
      if (seededKey !== null && seededKey !== key) {
        flush();
        seededKey = null;
      }
      if (key !== null && seededKey !== key) {
        seededKey = key;
        targetIds = [...ids];
        const colors = ids.map((id) => noteIndex.get(id)?.color);
        const same = colors.every((c) => c === colors[0]);
        color = same ? colors[0] : undefined;
        mixed = !same;
        dirty = false;
      }
    });
  });

  // Unmount while open still saves.
  $effect(() => () => untrack(flush));

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!dirty || targetIds.length === 0) return;
    dirty = false;
    const ids = [...targetIds];
    const value = color;
    // Resolved now: the write may settle after this component is gone.
    const translate = $t;
    // Serialized: each write reads the stored bundle and merges into it.
    saveChain = saveChain
      .then(async () => {
        const { done, failed } = await notesStore.setColor(ids, value);
        if (failed === 0) return;
        toastStore.error(
          ids.length === 1
            ? translate('notes.color.save_failed')
            : translate('notes.multiselect.partial_failure', {
                values: { done, total: ids.length, failed }
              })
        );
      })
      .catch(() => {
        toastStore.error(translate('notes.color.save_failed'));
      });
  }

  function chooseColor(value: string | undefined) {
    if (!mixed && value === color) return;
    color = value;
    mixed = false;
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  function close() {
    noteColorDialog.open = false;
  }

  const single = $derived(targetIds.length === 1);
  const previewLabel = $derived.by(() => {
    if (!single) return $t('notes.multiselect.count', { values: { count: targetIds.length } });
    const entry = noteIndex.get(targetIds[0]);
    return entry?.title || $t('notes.untitled');
  });
  const description = $derived(
    single
      ? $t('notes.color.description')
      : $t('notes.color.description_many', { values: { count: targetIds.length } })
  );
  const previewDotClass = $derived(
    !mixed && isAppearanceColor(color)
      ? APPEARANCE_SWATCH_CLASS[color]
      : 'border border-dashed border-muted-foreground/60'
  );
</script>

{#snippet picker()}
  <!-- Live preview: the note row's dot as it will look in the list. -->
  <div class="flex min-w-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
    <span class="h-2.5 w-2.5 shrink-0 rounded-full {previewDotClass}" aria-hidden="true"></span>
    <span class="min-w-0 truncate"><bdi>{previewLabel}</bdi></span>
  </div>

  <div class="mt-4">
    <span id="note-color-group-label" class="sr-only">{$t('notes.color.title')}</span>
    <AppearanceColorGroup
      value={color}
      {mixed}
      labelledby="note-color-group-label"
      noneLabel={$t('notes.color.no_color')}
      touch={isMobileQuery.value}
      onchoose={chooseColor}
    />
  </div>
{/snippet}

{#if isMobileQuery.value}
  <Sheet bind:open={noteColorDialog.open}>
    <SheetContent side="bottom" class="h-auto max-h-[90dvh] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>{$t('notes.color.title')}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div class="mt-2">
        {@render picker()}
      </div>
      <Button class="mt-4 w-full" onclick={close}>
        {$t('notes.color.done')}
      </Button>
    </SheetContent>
  </Sheet>
{:else}
  <Dialog bind:open={noteColorDialog.open}>
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{$t('notes.color.title')}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {@render picker()}
      <DialogFooter>
        <Button onclick={close}>{$t('notes.color.done')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
