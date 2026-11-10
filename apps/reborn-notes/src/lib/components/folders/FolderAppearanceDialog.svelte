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
   * Writes are debounced: arrowing through 25 icons must not run 25
   * encrypt + sync cycles. Only the field the user actually changed is sent,
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
  const ICON_COLUMNS = 5;

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
      columns: ICON_COLUMNS,
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

  // Larger targets on touch screens (44 px), compact on desktop.
  const tileSize = $derived(isMobileQuery.value ? 'h-11 w-11' : 'h-9 w-9');
  const iconColorClass = $derived(appearanceTextClass(color) ?? 'text-muted-foreground');
</script>

{#snippet picker()}
  {#if folder}
    <!-- Live preview: the folder as it now looks in the tree. -->
    <div class="flex min-w-0 items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <FolderGlyph {color} {icon} class="h-5 w-5" />
      <span class="min-w-0 truncate"><bdi>{folder.name}</bdi></span>
    </div>

    <section class="mt-4">
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
        class="grid w-fit grid-cols-5 gap-1.5"
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

{#if isMobileQuery.value}
  <Sheet bind:open>
    <SheetContent side="bottom" class="h-auto max-h-[90dvh] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>{$t('folders.appearance.title')}</SheetTitle>
        <SheetDescription>{$t('folders.appearance.description')}</SheetDescription>
      </SheetHeader>
      <div class="mt-2">
        {@render picker()}
      </div>
      <Button class="mt-4 w-full" onclick={() => (open = false)}>
        {$t('folders.appearance.done')}
      </Button>
    </SheetContent>
  </Sheet>
{:else}
  <Dialog bind:open>
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{$t('folders.appearance.title')}</DialogTitle>
        <DialogDescription>{$t('folders.appearance.description')}</DialogDescription>
      </DialogHeader>
      {@render picker()}
      <DialogFooter>
        <Button onclick={() => (open = false)}>{$t('folders.appearance.done')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
