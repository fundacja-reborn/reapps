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
  import { appSettings, editorMode } from '$lib/stores/app-settings.store';

  let {
    isActive,
    isMobile,
    label,
    onActivate
  }: {
    isActive: boolean;
    isMobile: boolean;
    label: string;
    onActivate: () => void;
  } = $props();

  let sheetOpen = $state(false);

  const FaceIcon = $derived($editorMode === 'live' ? PencilLine : Pencil);

  async function setEditorMode(value: 'markdown' | 'live') {
    sheetOpen = false;
    if ($editorMode === value) return;
    await appSettings.update('editorMode', value);
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
      <span class="hidden sm:inline">{label}</span>
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
          value={$editorMode}
          onValueChange={(v) => setEditorMode(v as 'markdown' | 'live')}
        >
          <DropdownMenuRadioItem value="markdown">
            {$t('editor_mode.markdown')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="live">
            <span>{$t('editor_mode.live')}</span>
            <span
              class="ml-auto inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            >
              {$t('editor_mode.beta')}
            </span>
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
          variant={$editorMode === 'markdown' ? 'secondary' : 'ghost'}
          class="w-full justify-start"
          onclick={() => setEditorMode('markdown')}
        >
          {$t('editor_mode.markdown')}
        </Button>
        <Button
          variant={$editorMode === 'live' ? 'secondary' : 'ghost'}
          class="w-full justify-start gap-2"
          onclick={() => setEditorMode('live')}
        >
          <span>{$t('editor_mode.live')}</span>
          <span
            class="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
          >
            {$t('editor_mode.beta')}
          </span>
        </Button>
      </div>
    </SheetContent>
  </Sheet>
{/if}
