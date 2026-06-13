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
    CalendarDays,
    Share2,
    Heart,
    UserPlus
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
  import { activeSharesCount } from '$lib/stores/shares.store';
  import { requireActiveSession } from '$lib/utils/require-active-session';
  import ManageSharesDialog from '../notes/ManageSharesDialog.svelte';
  import AccountRequiredDialog from '../shared/AccountRequiredDialog.svelte';

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
  let sharesDialogOpen = $state(false);
  // Local-only mode: sharing needs a server account - nudge to register instead.
  let accountRequiredOpen = $state(false);

  // Donations page on the foundation site (EN + PL only). Plain <a target="_blank">
  // leaves the app: new tab on web, SYSTEM browser in the native shell (the
  // webview origin is localhost, so Capacitor opens external hosts externally) -
  // Apple 3.2.2(iv) requires collecting donations outside the app.
  const SITE_URL: string =
    (import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? 'https://reapps.eu';
  const supportUrl = $derived(`${SITE_URL}${$i18nLocale === 'pl' ? '/pl' : ''}/support`);

  async function handleOpenShares() {
    if ($authStore.isLocalOnly) {
      accountRequiredOpen = true;
      return;
    }
    const ok = await requireActiveSession({
      description: $t('share.session_required.view')
    });
    if (!ok) return;
    sharesDialogOpen = true;
  }

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
    <!-- Shares (always visible, count badge when > 0) -->
    <button
      type="button"
      onclick={handleOpenShares}
      class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
        text-muted-foreground hover:bg-sidebar-accent/60"
      aria-label={$t('nav.shares')}
    >
      <span class="relative">
        <Share2 class="h-5 w-5" />
        {#if $activeSharesCount > 0}
          <span
            class="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center
              rounded-full bg-foreground/15 text-[8px] font-medium leading-none text-muted-foreground px-0.5"
            aria-label="{$activeSharesCount} {$t('nav.shares')}"
          >
            {$activeSharesCount > 99 ? '99+' : $activeSharesCount}
          </span>
        {/if}
      </span>
      <span class="text-[11px] leading-none">{$t('nav.shares')}</span>
    </button>
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
  <!-- padding-top: the 0.5rem base GROWS by the iOS notch inset (calc, not
       max) so the first icon keeps its web alignment with the list header,
       which also grows by the inset (env() is 0 elsewhere) -->
  <!-- overflow-y-auto + children shrink-0: when the Android keyboard resizes
       the webview (adjustResize), icons keep their size and the rail scrolls
       instead of squeezing; the flex-1 spacer still collapses first (basis-0),
       so the keyboard-closed layout is unchanged. -->
  <nav
    class="{alwaysVisible
      ? 'flex'
      : 'hidden md:flex'} w-14 md:w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-sidebar-border [&>*]:shrink-0"
    style="background-color: var(--icon-rail); padding-top: calc(0.5rem + env(safe-area-inset-top, 0px)); padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));"
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

    <!-- Shares (always visible, count badge when > 0) -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            onclick={handleOpenShares}
            class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg
                   text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label={$t('nav.shares')}
          >
            <span class="relative">
              <Share2 class="h-6 w-6 md:h-5 md:w-5" />
              {#if $activeSharesCount > 0}
                <span
                  class="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center
                    rounded-full bg-foreground/15 text-[9px] font-medium leading-none text-muted-foreground px-0.5"
                  aria-label="{$activeSharesCount} {$t('nav.shares')}"
                >
                  {$activeSharesCount > 99 ? '99+' : $activeSharesCount}
                </span>
              {/if}
            </span>
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" sideOffset={6}>{$t('nav.shares')}</Tooltip.Content>
    </Tooltip.Root>

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

    <!-- Support (donation page, leaves the app) -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <!-- eslint-disable svelte/no-navigation-without-resolve (external URL, leaves the app) -->
          <a
            {...props}
            href={supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg text-muted-foreground
                   hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label={$t('nav.support')}
          >
            <Heart class="h-6 w-6 md:h-5 md:w-5" />
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right" sideOffset={6}>{$t('nav.support')}</Tooltip.Content>
    </Tooltip.Root>

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
                  <span class="truncate font-medium"
                    >{$authStore.username ?? $t('local_mode.menu_title')}</span
                  >
                  <span class="truncate text-xs text-muted-foreground"
                    >{$authStore.isLocalOnly
                      ? $t('local_mode.menu_hint')
                      : $t('nav.e2ee_account')}</span
                  >
                </div>
              </div>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
            <DropdownMenu.Group>
              {#if $authStore.isLocalOnly}
                <DropdownMenu.Item onclick={() => goto('/auth/register')}>
                  <UserPlus class="h-4 w-4" />
                  {$t('local_mode.register')}
                </DropdownMenu.Item>
              {/if}
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

<!-- Shares manage dialog (mounted once, used by both nav modes) -->
<ManageSharesDialog bind:open={sharesDialogOpen} sourceId={null} />
<AccountRequiredDialog bind:open={accountRequiredOpen} />

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
            <span class="truncate font-medium">{$authStore.username ?? $t('local_mode.menu_title')}</span>
            <span class="truncate text-xs font-normal text-muted-foreground"
              >{$authStore.isLocalOnly ? $t('local_mode.menu_hint') : $t('nav.e2ee_account')}</span
            >
          </div>
        </div>
      </SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
      {#if $authStore.isLocalOnly}
        <Button
          variant="ghost"
          class="w-full justify-start min-h-11"
          onclick={() => {
            userSheetOpen = false;
            goto('/auth/register');
          }}
        >
          <UserPlus class="mr-2 h-5 w-5" />
          {$t('local_mode.register')}
        </Button>
      {/if}
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
