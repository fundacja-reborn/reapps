<script lang="ts">
  import { untrack } from 'svelte';
  import { textDirection } from '@reborn/i18n';
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
  import type { FolderWithChildren } from '@reborn/types';
  import { foldersStore } from '$lib/stores/folders.store';
  import { t } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { appearanceTextClass } from '$lib/utils/appearance-colors';
  import { FOLDER_ICONS } from '$lib/utils/folder-icons';
  import { radioGridTarget } from '$lib/utils/radio-grid-nav';
  import AppearanceColorGroup from '../AppearanceColorGroup.svelte';
  import FolderGlyph from './FolderGlyph.svelte';
  import { FOLDER_ICON_COMPONENTS } from './folder-icon-components';

  /**
   * Color + icon picker for one folder. Desktop: centered dialog; mobile:
   * bottom sheet. Both are radio groups with roving tabindex (arrows move and
   * select). A choice applies right away - no Save step, like the tag color -
   * and the tree behind updates live.
   *
   * Writes are debounced: arrowing through the icon grid must not run one
   * encrypt + sync cycle per icon. Only the field the user actually changed is sent,
   * so a color/icon key this build does not know (set by a newer app version)
   * is never overwritten by merely opening the dialog. Closing flushes.
   */
  let {
    open = $bindable(false),
    folder
  }: {
    open?: boolean;
    folder: FolderWithChildren | null;
  } = $props();

  const isMobileQuery = useIsMobile();

  const SAVE_DEBOUNCE_MS = 300;
  // Icon grid: 8 columns in the desktop dialog, 6 in the mobile sheet (the
  // tiles are larger there). Arrow-key navigation follows the same number.
  const iconColumns = $derived(isMobileQuery.value ? 6 : 8);

  // Icon options: `undefined` = the plain folder icon.
  const iconOptions: (string | undefined)[] = [undefined, ...FOLDER_ICONS];

  let color = $state<string | undefined>(undefined);
  let icon = $state<string | undefined>(undefined);

  // Plain (non-reactive) bookkeeping: read and written only from handlers.
  let seededFor: string | null = null;
  let dirtyColor = false;
  let dirtyIcon = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveChain: Promise<void> = Promise.resolve();

  // Seed the local choice once per opening. Not on every store refresh: the
  // refresh after our own save would otherwise fight a choice still in flight.
  // Closing (or the host swapping in another folder) flushes the pending save
  // of the folder it was seeded for first.
  $effect(() => {
    const target = open ? folder : null;
    const targetId = target?.id ?? null;
    untrack(() => {
      if (seededFor !== null && seededFor !== targetId) {
        flush();
        seededFor = null;
      }
      if (target && seededFor !== target.id) {
        seededFor = target.id;
        color = target.color;
        icon = target.icon;
        dirtyColor = false;
        dirtyIcon = false;
      }
    });
  });

  // Unmount while open (e.g. the host view closed) still saves.
  $effect(() => () => untrack(flush));

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const id = seededFor;
    if (!id || (!dirtyColor && !dirtyIcon)) return;
    const patch: { color?: string | undefined; icon?: string | undefined } = {};
    if (dirtyColor) patch.color = color;
    if (dirtyIcon) patch.icon = icon;
    dirtyColor = false;
    dirtyIcon = false;
    // Resolved now: the write may settle after this component is gone.
    const failedMessage = $t('folders.appearance.save_failed');
    // Serialized: each write reads the stored bundle and merges into it.
    saveChain = saveChain
      .then(() => foldersStore.setAppearance(id, patch))
      .catch(() => {
        toastStore.error(failedMessage);
      });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  function chooseColor(value: string | undefined) {
    if (value === color) return;
    color = value;
    dirtyColor = true;
    scheduleSave();
  }

  function chooseIcon(value: string | undefined) {
    if (value === icon) return;
    icon = value;
    dirtyIcon = true;
    scheduleSave();
  }

  // A stored key this build does not know matches no option; the default
  // option then keeps the tab stop so the group stays reachable.
  const iconIndex = $derived(Math.max(0, iconOptions.indexOf(icon)));

  function handleIconKeydown(e: KeyboardEvent) {
    const next = radioGridTarget(e.key, iconIndex, iconOptions.length, {
      columns: iconColumns,
      rtl: $textDirection === 'rtl'
    });
    if (next === null) return;
    e.preventDefault();
    chooseIcon(iconOptions[next]);
    iconGroupEl?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }

  function iconLabel(value: string | undefined): string {
    return value ? $t(`folders.appearance.icons.${value}`) : $t('folders.appearance.default_icon');
  }

  let iconGroupEl = $state<HTMLElement | null>(null);

  // Larger targets on touch screens (44 px, shrinking with the sheet on very
  // narrow phones), compact on desktop.
  const tileSize = $derived(isMobileQuery.value ? 'aspect-square w-full' : 'h-9 w-9');
  const iconGridClass = $derived(
    isMobileQuery.value ? 'w-full max-w-[18.375rem] grid-cols-6' : 'w-fit grid-cols-8'
  );
  const iconColorClass = $derived(appearanceTextClass(color) ?? 'text-muted-foreground');

  // "There is more" cue for the scrolling region: its content fades out at an
  // edge with more beyond it. Not a forced scrollbar - on iOS, Android and
  // macOS ("show scroll bars: when scrolling") the bar is the system's overlay,
  // shown only while scrolling, and scrollbar styles are ignored there.
  // Re-measured on scroll and when the region or its content changes size
  // (phone rotation, the tile size switching with the layout).
  let scrollEl = $state<HTMLElement | null>(null);
  let scrollContentEl = $state<HTMLElement | null>(null);
  let moreAbove = $state(false);
  let moreBelow = $state(false);

  function updateScrollEdges() {
    if (!scrollEl) return;
    const { scrollTop, clientHeight, scrollHeight } = scrollEl;
    // 1 px slack: fractional sizes on scaled displays.
    moreAbove = scrollTop > 1;
    moreBelow = scrollTop + clientHeight < scrollHeight - 1;
  }

  $effect(() => {
    if (!scrollEl || !scrollContentEl) return;
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(scrollEl);
    observer.observe(scrollContentEl);
    return () => observer.disconnect();
  });
</script>

{#snippet preview()}
  {#if folder}
    <!-- Live preview: the folder as it now looks in the tree. Stays in view
         while the choices below scroll. -->
    <div class="flex min-w-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <FolderGlyph {color} {icon} class="h-5 w-5" />
      <span class="min-w-0 truncate"><bdi>{folder.name}</bdi></span>
    </div>
  {/if}
{/snippet}

{#snippet choices()}
  {#if folder}
    <section>
      <h3 id="folder-appearance-color" class="mb-2 text-sm font-medium">
        {$t('folders.appearance.color')}
      </h3>
      <AppearanceColorGroup
        value={color}
        labelledby="folder-appearance-color"
        noneLabel={$t('folders.appearance.no_color')}
        touch={isMobileQuery.value}
        onchoose={chooseColor}
      />
    </section>

    <section class="mt-4">
      <h3 id="folder-appearance-icon" class="mb-2 text-sm font-medium">
        {$t('folders.appearance.icon')}
      </h3>
      <div
        bind:this={iconGroupEl}
        role="radiogroup"
        aria-labelledby="folder-appearance-icon"
        tabindex="-1"
        class="grid {iconGridClass} gap-1.5"
        onkeydown={handleIconKeydown}
      >
        {#each iconOptions as option, i (option ?? 'default')}
          {@const checked = i === iconIndex}
          {@const Icon = option
            ? FOLDER_ICON_COMPONENTS[option as keyof typeof FOLDER_ICON_COMPONENTS]
            : null}
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconLabel(option)}
            title={iconLabel(option)}
            tabindex={checked ? 0 : -1}
            class="flex {tileSize} items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              {checked ? 'bg-accent ring-2 ring-primary' : ''}"
            onclick={() => chooseIcon(option)}
          >
            {#if Icon}
              <Icon class="h-5 w-5 {iconColorClass}" />
            {:else}
              <FolderGlyph {color} class="h-5 w-5" />
            {/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
{/snippet}

{#snippet scrollingChoices()}
  <!-- Wrapper = the flex item that shrinks; it also anchors the edge fades,
       which sit outside the scrolling box so they stay put while it scrolls. -->
  <div class="relative -mx-6 mt-3 flex min-h-0 flex-col border-y">
    <div
      bind:this={scrollEl}
      class="min-h-0 overflow-y-auto overscroll-contain px-6 py-3"
      onscroll={updateScrollEdges}
    >
      <div bind:this={scrollContentEl}>
        {@render choices()}
      </div>
    </div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-popover to-transparent transition-opacity motion-reduce:transition-none
        {moreAbove ? 'opacity-100' : 'opacity-0'}"
    ></div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-popover to-transparent transition-opacity motion-reduce:transition-none
        {moreBelow ? 'opacity-100' : 'opacity-0'}"
    ></div>
  </div>
{/snippet}

<!--
  Layout (#642): title and preview on top and "Done" at the bottom stay put;
  colors and icons scroll together in between. One scroll region rather than a
  grid scrolling on its own under fixed colors: on a small phone that leaves
  ~7 rows of icons in view instead of ~4. The region is the default
  `flex: 0 1 auto` (not `flex-1`), so a short list keeps the dialog short and
  only a long one shrinks it to the height cap. `-mx-6 px-6` and `py-3` keep
  focus rings and the swatches' hover zoom inside the clipped region, the
  borders mark where the scrolling part starts and ends, and the fades say
  there is more beyond an edge (nothing shows when everything fits).
-->{#if isMobileQuery.value}
  <Sheet bind:open>
    <SheetContent
      side="bottom"
      class="flex h-auto max-h-[90dvh] flex-col gap-0 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <SheetHeader class="shrink-0">
        <SheetTitle>{$t('folders.appearance.title')}</SheetTitle>
        <SheetDescription>{$t('folders.appearance.description')}</SheetDescription>
      </SheetHeader>
      <div class="mt-3 shrink-0">
        {@render preview()}
      </div>
      {@render scrollingChoices()}
      <Button class="mt-4 w-full shrink-0" onclick={() => (open = false)}>
        {$t('folders.appearance.done')}
      </Button>
    </SheetContent>
  </Sheet>
{:else}
  <Dialog bind:open>
    <DialogContent class="flex flex-col gap-0 overflow-hidden sm:max-w-sm">
      <DialogHeader class="shrink-0">
        <DialogTitle>{$t('folders.appearance.title')}</DialogTitle>
        <DialogDescription>{$t('folders.appearance.description')}</DialogDescription>
      </DialogHeader>
      <div class="mt-4 shrink-0">
        {@render preview()}
      </div>
      {@render scrollingChoices()}
      <DialogFooter class="mt-4 shrink-0">
        <Button onclick={() => (open = false)}>{$t('folders.appearance.done')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
