<script lang="ts">
  import { Pencil, PencilLine, ChevronDown } from '@lucide/svelte';
  import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    Button
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { editorModeOverride, effectiveEditorMode } from '$lib/stores/app-settings.store';

  let {
    viewMode,
    isMobile,
    label,
    onActivate
  }: {
    viewMode: 'edit' | 'split' | 'preview';
    isMobile: boolean;
    label: string;
    onActivate: () => void;
  } = $props();

  let sheetOpen = $state(false);

  const isActive = $derived(viewMode === 'edit');
  const FaceIcon = $derived($effectiveEditorMode === 'live' ? PencilLine : Pencil);

  // Picking a mode here is a per-note override, not a global change: it applies
  // only to the open note and is reset when the user leaves it (see
  // `editorModeOverride`). The synced default lives in Settings > Behavior.
  function setEditorMode(value: 'markdown' | 'live') {
    sheetOpen = false;
    editorModeOverride.set(value);
    onActivate();
  }
</script>

<div
  class="flex h-8 md:h-7 items-stretch rounded text-xs transition-colors
    {isActive
    ? 'bg-accent font-medium text-accent-foreground'
    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'}"
  role="group"
  aria-label={$t('editor_mode.label')}
>
  <button
    type="button"
    onclick={onActivate}
    title={label}
    aria-label={label}
    aria-pressed={isActive}
    class="flex items-center gap-1.5 rounded-l pl-2 pr-1.5"
  >
    <FaceIcon class="h-4 w-4 md:h-3.5 md:w-3.5" />
    {#if !isMobile}
      <!-- Labels collapse to icons when the note pane is narrow (container query
           on the header, ~@lg). Keeps the toolbar from clipping the trailing
           icons/kebab in the 768-960px desktop range where the pane is tight. -->
      <span class="hidden @lg:inline">{label}</span>
    {/if}
  </button>

  <span class="my-1 w-px self-stretch bg-current opacity-20" aria-hidden="true"></span>

  {#if isMobile}
    <button
      type="button"
      onclick={() => (sheetOpen = true)}
      title={$t('editor_mode.open_menu')}
      aria-label={$t('editor_mode.open_menu')}
      aria-haspopup="menu"
      class="flex items-center justify-center rounded-r pl-1 pr-1.5"
    >
      <ChevronDown class="h-3.5 w-3.5" />
    </button>
  {:else}
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            title={$t('editor_mode.open_menu')}
            aria-label={$t('editor_mode.open_menu')}
            aria-haspopup="menu"
            class="flex items-center justify-center rounded-r pl-1 pr-1.5"
          >
            <ChevronDown class="h-3 w-3" />
          </button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-52">
        <DropdownMenuLabel
          class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {$t('editor_mode.label')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={$effectiveEditorMode}
          onValueChange={(v) => setEditorMode(v as 'markdown' | 'live')}
        >
          <DropdownMenuRadioItem value="markdown">
            {$t('editor_mode.markdown')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="live">
            {$t('editor_mode.live')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  {/if}
</div>

{#if isMobile}
  <Sheet bind:open={sheetOpen}>
    <SheetContent side="bottom" class="h-auto">
      <SheetHeader>
        <SheetTitle>{$t('editor_mode.label')}</SheetTitle>
      </SheetHeader>
      <div class="mt-4 space-y-1 pb-4">
        <Button
          variant={$effectiveEditorMode === 'markdown' ? 'secondary' : 'ghost'}
          class="w-full justify-start"
          onclick={() => setEditorMode('markdown')}
        >
          {$t('editor_mode.markdown')}
        </Button>
        <Button
          variant={$effectiveEditorMode === 'live' ? 'secondary' : 'ghost'}
          class="w-full justify-start"
          onclick={() => setEditorMode('live')}
        >
          {$t('editor_mode.live')}
        </Button>
      </div>
    </SheetContent>
  </Sheet>
{/if}
