<script lang="ts" module>
  export type Section =
    | 'all'
    | 'starred'
    | 'folders'
    | 'tags'
    | 'trash'
    | 'search'
    | 'periodic-daily'
    | 'periodic-weekly'
    | 'periodic-monthly';

  export const PERIODIC_SECTIONS = ['periodic-daily', 'periodic-weekly', 'periodic-monthly'] as const;
  export type PeriodicSection = (typeof PERIODIC_SECTIONS)[number];
  export const isPeriodicSection = (s: string): s is PeriodicSection =>
    (PERIODIC_SECTIONS as readonly string[]).includes(s);
</script>

<script lang="ts">
  import {
    PenLine,
    Search,
    BookOpen,
    Star,
    Folder,
    Tag,
    Trash2,
    Settings,
    LogOut,
    Shield,
    CalendarCheck,
    CalendarRange,
    CalendarDays
  } from '@lucide/svelte';
  import * as Tooltip from '@reborn/ui/components/tooltip';
  import * as DropdownMenu from '@reborn/ui/components/dropdown-menu';
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { authStore, getUserInitial } from '$lib/stores/auth.store';
  import { goto } from '$lib/utils/navigation';
  import { base } from '$app/paths';
  import { t, locale as i18nLocale } from '$lib/stores/i18n.store';
  import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
  import { periodicNotesSettings } from '$lib/stores/app-settings.store';
  import { formatRange } from '$lib/services/periodic-notes-format';
  import type { PeriodicKind } from '@reborn/storage';

  let {
    activeSection = $bindable<Section>('all'),
    onNewNote,
    onsectionclick,
    onPeriodic,
    horizontal = false,
    alwaysVisible = false
  }: {
    activeSection?: Section;
    onNewNote?: () => void;
    /** Fires on every section click, even when clicking the already-active section */
    onsectionclick?: (section: Section) => void;
    /** Open or create the daily/weekly/monthly note for the current period. */
    onPeriodic?: (kind: PeriodicKind) => void;
    /** Horizontal mode for mobile sheet header */
    horizontal?: boolean;
    /** Show icon rail regardless of breakpoint (for mobile master-detail layout) */
    alwaysVisible?: boolean;
  } = $props();

  const isMobileQuery = useIsMobile();
  let loggingOut = $state(false);
  let userSheetOpen = $state(false);

  // Refresh `now` every minute so tooltips stay accurate across midnight /
  // week boundary / month boundary without forcing the user to reload.
  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => {
      now = new Date();
    }, 60_000);
    return () => clearInterval(id);
  });

  function handleLogout() {
    loggingOut = true;
    authStore.logout();
  }

  const PERIODIC_BUTTONS = $derived(
    [
      { kind: 'daily' as const, icon: CalendarCheck },
      { kind: 'weekly' as const, icon: CalendarRange },
      { kind: 'monthly' as const, icon: CalendarDays }
    ].filter((b) => $periodicNotesSettings[b.kind].enabled)
  );

  function periodicTooltip(kind: PeriodicKind): string {
    const range = formatRange(kind, now, $i18nLocale || 'en');
    return $t(`notes.periodic.${kind}.button.tooltip`, { values: { range } });
  }

  function periodicLabel(kind: PeriodicKind): string {
    return $t(`notes.periodic.${kind}.button.label`);
  }

  const PRIMARY_SECTIONS = $derived([
    {
      id: 'all' as Section,
      label: $t('nav.all_notes'),
      short: $t('nav.all_notes'),
      icon: BookOpen
    },
    { id: 'starred' as Section, label: $t('nav.starred'), short: $t('nav.starred'), icon: Star }
  ]);

  const ORGANIZE_SECTIONS = $derived([
    { id: 'folders' as Section, label: $t('nav.folders'), short: $t('nav.folders'), icon: Folder },
    { id: 'tags' as Section, label: $t('nav.tags'), short: $t('nav.tags'), icon: Tag }
  ]);

  const TRASH_SECTION = $derived({
    id: 'trash' as Section,
    label: $t('nav.trash'),
    short: $t('nav.trash'),
    icon: Trash2
  });
</script>

{#if horizontal}
  <!-- ── Horizontal mode (mobile sheet header) ─────────────────── -->
  <div class="flex items-center gap-1 pb-1 pt-0.5">
    <!-- New note -->
    <button
      type="button"
      onclick={onNewNote}
      class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs
             text-muted-foreground hover:bg-sidebar-accent/60 transition-colors"
      aria-label={$t('nav.new_note')}
    >
      <PenLine class="h-5 w-5" />
      <span class="text-[11px] leading-none">{$t('nav.new_short')}</span>
    </button>
    <!-- Search -->
    <button
      type="button"
      onclick={() => {
        activeSection = 'search';
        onsectionclick?.('search');
      }}
      class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
        {activeSection === 'search'
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-muted-foreground hover:bg-sidebar-accent/60'}"
      aria-label={$t('nav.search')}
      aria-current={activeSection === 'search' ? 'page' : undefined}
    >
      <Search class="h-5 w-5" />
      <span class="text-[11px] leading-none">{$t('nav.search')}</span>
    </button>
    <!-- Primary views (All, Starred) -->
    {#each PRIMARY_SECTIONS as s}
      <button
        type="button"
        onclick={() => {
          activeSection = s.id;
          onsectionclick?.(s.id);
        }}
        class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
          {activeSection === s.id
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60'}"
        aria-label={s.label}
        aria-current={activeSection === s.id ? 'page' : undefined}
      >
        <s.icon class="h-5 w-5" />
        <span class="text-[11px] leading-none">{s.short}</span>
      </button>
    {/each}
    <!-- Organization (Folders, Tags) -->
    {#each ORGANIZE_SECTIONS as s}
      <button
        type="button"
        onclick={() => {
          activeSection = s.id;
          onsectionclick?.(s.id);
        }}
        class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
          {activeSection === s.id
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60'}"
        aria-label={s.label}
        aria-current={activeSection === s.id ? 'page' : undefined}
      >
        <s.icon class="h-5 w-5" />
        <span class="text-[11px] leading-none">{s.short}</span>
      </button>
    {/each}
    <!-- Periodic notes (Daily / Weekly / Monthly) -->
    {#each PERIODIC_BUTTONS as p (p.kind)}
      {@const sectionId = `periodic-${p.kind}` as const}
      {@const isActive = activeSection === sectionId}
      <button
        type="button"
        onclick={() => onPeriodic?.(p.kind)}
        class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
          {isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60'}"
        aria-label={periodicTooltip(p.kind)}
        aria-current={isActive ? 'page' : undefined}
        title={periodicTooltip(p.kind)}
      >
        <p.icon class="h-5 w-5" />
        <span class="text-[11px] leading-none">{periodicLabel(p.kind)}</span>
      </button>
    {/each}
    <!-- Trash -->
    <button
      type="button"
      onclick={() => {
        activeSection = TRASH_SECTION.id;
        onsectionclick?.(TRASH_SECTION.id);
      }}
      class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
        {activeSection === TRASH_SECTION.id
        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
        : 'text-muted-foreground hover:bg-sidebar-accent/60'}"
      aria-label={TRASH_SECTION.label}
      aria-current={activeSection === TRASH_SECTION.id ? 'page' : undefined}
    >
      <TRASH_SECTION.icon class="h-5 w-5" />
      <span class="text-[11px] leading-none">{TRASH_SECTION.short}</span>
    </button>
  </div>
{:else}
  <!-- ── Vertical mode (desktop icon rail) ─────────────────────── -->
  <nav
    class="{alwaysVisible
      ? 'flex'
      : 'hidden md:flex'} w-14 md:w-12 shrink-0 flex-col items-center gap-1 pt-2 border-r border-sidebar-border"
    style="background-color: var(--icon-rail); padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));"
    aria-label={$t('nav.main_navigation')}
  >
    <!-- New note -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            onclick={onNewNote}
            class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg text-sidebar-foreground
                   hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label={$t('nav.new_note')}
          >
            <PenLine class="h-6 w-6 md:h-5 md:w-5" />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" sideOffset={6}>{$t('nav.new_note')}</Tooltip.Content>
    </Tooltip.Root>

    <!-- Search -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            onclick={() => {
              activeSection = 'search';
              onsectionclick?.('search');
            }}
            class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors
              {activeSection === 'search'
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
            aria-label={$t('nav.search')}
            aria-current={activeSection === 'search' ? 'page' : undefined}
          >
            <Search class="h-6 w-6 md:h-5 md:w-5" />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" sideOffset={6}>{$t('nav.search')}</Tooltip.Content>
    </Tooltip.Root>

    <!-- Primary views (All, Starred) -->
    {#each PRIMARY_SECTIONS as s}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              onclick={() => {
                activeSection = s.id;
                onsectionclick?.(s.id);
              }}
              class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors
                {activeSection === s.id
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
              aria-label={s.label}
              aria-current={activeSection === s.id ? 'page' : undefined}
            >
              <s.icon class="h-6 w-6 md:h-5 md:w-5" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right" sideOffset={6}>{s.label}</Tooltip.Content>
      </Tooltip.Root>
    {/each}

    <!-- Organization (Folders, Tags) -->
    {#each ORGANIZE_SECTIONS as s}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              onclick={() => {
                activeSection = s.id;
                onsectionclick?.(s.id);
              }}
              class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors
                {activeSection === s.id
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
              aria-label={s.label}
              aria-current={activeSection === s.id ? 'page' : undefined}
            >
              <s.icon class="h-6 w-6 md:h-5 md:w-5" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right" sideOffset={6}>{s.label}</Tooltip.Content>
      </Tooltip.Root>
    {/each}

    <!-- Periodic notes (Daily / Weekly / Monthly) -->
    {#each PERIODIC_BUTTONS as p (p.kind)}
      {@const sectionId = `periodic-${p.kind}` as const}
      {@const isActive = activeSection === sectionId}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              onclick={() => onPeriodic?.(p.kind)}
              class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors
                {isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
              aria-label={periodicTooltip(p.kind)}
              aria-current={isActive ? 'page' : undefined}
            >
              <p.icon class="h-6 w-6 md:h-5 md:w-5" />
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="right" sideOffset={6}>{periodicTooltip(p.kind)}</Tooltip.Content>
      </Tooltip.Root>
    {/each}

    <!-- Trash -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            onclick={() => {
              activeSection = TRASH_SECTION.id;
              onsectionclick?.(TRASH_SECTION.id);
            }}
            class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors
              {activeSection === TRASH_SECTION.id
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
            aria-label={TRASH_SECTION.label}
            aria-current={activeSection === TRASH_SECTION.id ? 'page' : undefined}
          >
            <TRASH_SECTION.icon class="h-6 w-6 md:h-5 md:w-5" />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" sideOffset={6}>{TRASH_SECTION.label}</Tooltip.Content>
    </Tooltip.Root>

    <div class="flex-1"></div>

    <!-- Settings -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            onclick={() => goto('/settings')}
            class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg text-muted-foreground
                   hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label={$t('nav.settings')}
          >
            <Settings class="h-6 w-6 md:h-5 md:w-5" />
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" sideOffset={6}>{$t('nav.settings')}</Tooltip.Content>
    </Tooltip.Root>

    <!-- User avatar + menu -->
    {#if !loggingOut}
      {#if isMobileQuery.value}
        <button
          type="button"
          onclick={() => (userSheetOpen = true)}
          class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors"
          aria-label={$t('nav.user_menu')}
        >
          <span
            class="flex h-9 w-9 md:h-7 md:w-7 select-none items-center justify-center rounded-full bg-primary/10
                   text-sm md:text-xs font-semibold text-primary"
          >
            {getUserInitial($authStore.username)}
          </span>
        </button>
      {:else}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors"
                aria-label={$t('nav.user_menu')}
              >
                <span
                  class="flex h-7 w-7 select-none items-center justify-center rounded-full bg-primary/10
                         text-xs font-semibold text-primary"
                >
                  {getUserInitial($authStore.username)}
                </span>
              </button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="min-w-48 rounded-lg" side="right" align="end" sideOffset={6}>
            <DropdownMenu.Label class="p-0 font-normal">
              <div class="flex items-center gap-2 px-2 py-1.5 text-start text-sm">
                <span
                  class="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-primary/10
                         text-xs font-semibold text-primary"
                >
                  {getUserInitial($authStore.username)}
                </span>
                <div class="grid flex-1 text-start text-sm leading-tight">
                  <span class="truncate font-medium">{$authStore.username ?? '—'}</span>
                  <span class="truncate text-xs text-muted-foreground"
                    >{$t('nav.e2ee_account')}</span
                  >
                </div>
              </div>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Group>
              <DropdownMenu.Item onclick={() => goto('/settings')}>
                <Settings class="h-4 w-4" />
                {$t('nav.settings')}
              </DropdownMenu.Item>
            </DropdownMenu.Group>
            {#if $authStore.isAuthenticated}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                onclick={handleLogout}
                class="text-destructive focus:text-destructive"
              >
                <LogOut class="h-4 w-4" />
                {$t('nav.log_out')}
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    {/if}
  </nav>
{/if}

<!-- Mobile: User menu Sheet -->
<Sheet bind:open={userSheetOpen}>
  <SheetContent side="bottom" class="h-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
    <SheetHeader>
      <SheetTitle>
        <div class="flex items-center gap-3">
          <span
            class="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full bg-primary/10
                   text-sm font-semibold text-primary"
          >
            {getUserInitial($authStore.username)}
          </span>
          <div class="grid flex-1 text-start text-sm leading-tight">
            <span class="truncate font-medium">{$authStore.username ?? '—'}</span>
            <span class="truncate text-xs font-normal text-muted-foreground"
              >{$t('nav.e2ee_account')}</span
            >
          </div>
        </div>
      </SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      <Button
        variant="ghost"
        class="w-full justify-start min-h-11"
        onclick={() => {
          userSheetOpen = false;
          goto('/settings');
        }}
      >
        <Settings class="mr-2 h-5 w-5" />
        {$t('nav.settings')}
      </Button>
      {#if $authStore.isAuthenticated}
        <Button
          variant="ghost"
          class="w-full justify-start min-h-11 text-destructive hover:text-destructive"
          onclick={() => {
            userSheetOpen = false;
            handleLogout();
          }}
        >
          <LogOut class="mr-2 h-5 w-5" />
          {$t('nav.log_out')}
        </Button>
      {/if}
    </div>
  </SheetContent>
</Sheet>
