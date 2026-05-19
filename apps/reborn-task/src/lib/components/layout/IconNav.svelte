<script lang="ts" module>
	export type Section =
		| 'all'
		| 'lists'
		| 'starred'
		| 'overdue'
		| 'today'
		| 'upcoming'
		| 'no_date'
		| 'trash';
</script>

<script lang="ts">
	import {
		SquarePlus,
		Search,
		ListTodo,
		Star,
		CircleAlert,
		Sun,
		CalendarDays,
		CalendarOff,
		Trash2,
		Settings,
		LogOut,
		Share2
	} from '@lucide/svelte';
	import {
		overdueTasks,
		todayTasks,
		starredTasks,
		upcomingTasks,
		noDateTasks
	} from '$lib/stores/decrypted-tasks.store';
	import * as Tooltip from '@reborn/ui/components/tooltip';
	import * as DropdownMenu from '@reborn/ui/components/dropdown-menu';
	import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
	import { session } from '$lib/stores/auth.store';
	import { goto } from '$lib/utils/navigation';
	import { t } from '$lib/stores/i18n.store';
	import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
	import { activeSharesCount } from '$lib/stores/shares.store';
	import { requireActiveSession } from '$lib/utils/require-active-session';
	import ManageSharesDialog from '$lib/components/tasks/ManageSharesDialog.svelte';

	let {
		activeSection = $bindable<Section>('lists'),
		onNewTask,
		onSectionClick,
		horizontal = false,
		alwaysVisible = false
	}: {
		activeSection?: Section;
		onNewTask?: () => void;
		onSectionClick?: (section: Section) => void;
		horizontal?: boolean;
		alwaysVisible?: boolean;
	} = $props();

	const isMobileQuery = useIsMobile();
	let loggingOut = $state(false);
	let userSheetOpen = $state(false);
	let sharesDialogOpen = $state(false);

	async function handleOpenShares() {
		const ok = await requireActiveSession({
			description: $t('share.session_required.view')
		});
		if (!ok) return;
		sharesDialogOpen = true;
	}

	function getUserInitial(username: string | null): string {
		if (!username) return '?';
		return username.charAt(0).toUpperCase();
	}

	async function handleLogout() {
		loggingOut = true;
		const { authOperationsService } = await import('$lib/services/auth-operations.service');
		await authOperationsService.logout();
	}

	const SECTIONS = $derived([
		{
			id: 'all' as Section,
			label: $t('taskList.filter.all'),
			short: $t('taskList.filter.all'),
			icon: Search
		},
		{
			id: 'lists' as Section,
			label: $t('task.sidebar.task_lists'),
			short: $t('task.sidebar.task_lists'),
			icon: ListTodo
		},
		{
			id: 'starred' as Section,
			label: $t('taskList.filter.starred_only'),
			short: $t('taskList.filter.starred_only'),
			icon: Star
		},
		{
			id: 'overdue' as Section,
			label: $t('taskList.filter.date.overdue'),
			short: $t('taskList.filter.date.overdue'),
			icon: CircleAlert
		},
		{
			id: 'today' as Section,
			label: $t('taskList.filter.date.today'),
			short: $t('taskList.filter.date.today'),
			icon: Sun
		},
		{
			id: 'upcoming' as Section,
			label: $t('taskList.filter.date.upcoming'),
			short: $t('taskList.filter.date.upcoming'),
			icon: CalendarDays
		},
		{
			id: 'no_date' as Section,
			label: $t('taskList.filter.date.no_date'),
			short: $t('taskList.filter.date.no_date'),
			icon: CalendarOff
		}
	]);

	const TRASH_SECTION = $derived({
		id: 'trash' as Section,
		label: $t('task.sidebar.trash'),
		short: $t('task.sidebar.trash'),
		icon: Trash2
	});
</script>

{#if horizontal}
	<!-- ── Horizontal mode (mobile sheet header) ─────────────────── -->
	<div class="flex items-center gap-1 pb-1 pt-0.5 overflow-x-auto">
		<!-- New task button -->
		<button
			type="button"
			onclick={onNewTask}
			class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs
             text-muted-foreground hover:bg-sidebar-accent/60 transition-colors"
			aria-label={$t('task.create.title')}
		>
			<SquarePlus class="h-5 w-5" />
			<span class="text-[11px] leading-none">{$t('common.new', { default: 'Nowe' })}</span>
		</button>
		{#each SECTIONS as s (s.id)}
			<button
				type="button"
				onclick={() => {
					onSectionClick?.(s.id);
					activeSection = s.id;
				}}
				class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
          {activeSection === s.id
					? 'bg-sidebar-accent text-sidebar-accent-foreground'
					: 'text-muted-foreground hover:bg-sidebar-accent/60'}"
				aria-label={s.label}
				aria-current={activeSection === s.id ? 'page' : undefined}
			>
				<span class="relative">
					<s.icon class="h-5 w-5" />
					{#if s.id === 'overdue' && $overdueTasks.length > 0}
						<span
							class="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center
								rounded-full text-[8px] font-bold leading-none text-white px-0.5"
							style="background-color: #FF8C42"
							aria-label="{$overdueTasks.length} {$t('taskList.filter.date.overdue')}"
						>
							{$overdueTasks.length > 99 ? '99+' : $overdueTasks.length}
						</span>
					{:else if s.id === 'today' && $todayTasks.length > 0}
						<span
							class="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center
								rounded-full text-[8px] font-bold leading-none text-white px-0.5"
							style="background-color: #FF8C42"
							aria-label="{$todayTasks.length} {$t('taskList.filter.date.today')}"
						>
							{$todayTasks.length > 99 ? '99+' : $todayTasks.length}
						</span>
					{:else if s.id === 'starred' && $starredTasks.length > 0}
						<span
							class="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center
								rounded-full bg-foreground/15 text-[8px] font-medium leading-none text-muted-foreground px-0.5"
							aria-label="{$starredTasks.length} {$t('taskList.filter.starred_only')}"
						>
							{$starredTasks.length > 99 ? '99+' : $starredTasks.length}
						</span>
					{:else if s.id === 'upcoming' && $upcomingTasks.length > 0}
						<span
							class="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center
								rounded-full bg-foreground/15 text-[8px] font-medium leading-none text-muted-foreground px-0.5"
							aria-label="{$upcomingTasks.length} {$t('taskList.filter.date.upcoming')}"
						>
							{$upcomingTasks.length > 99 ? '99+' : $upcomingTasks.length}
						</span>
					{:else if s.id === 'no_date' && $noDateTasks.length > 0}
						<span
							class="absolute -top-1 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center
								rounded-full bg-foreground/15 text-[8px] font-medium leading-none text-muted-foreground px-0.5"
							aria-label="{$noDateTasks.length} {$t('taskList.filter.date.no_date')}"
						>
							{$noDateTasks.length > 99 ? '99+' : $noDateTasks.length}
						</span>
					{/if}
				</span>
				<span class="text-[11px] leading-none whitespace-nowrap">{s.short}</span>
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
			<span class="text-[11px] leading-none whitespace-nowrap">{$t('nav.shares')}</span>
		</button>
		<!-- Trash -->
		<button
			type="button"
			onclick={() => {
				onSectionClick?.(TRASH_SECTION.id);
				activeSection = TRASH_SECTION.id;
			}}
			class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 px-1.5 text-xs transition-colors
				{activeSection === TRASH_SECTION.id
				? 'bg-sidebar-accent text-sidebar-accent-foreground'
				: 'text-muted-foreground hover:bg-sidebar-accent/60'}"
			aria-label={TRASH_SECTION.label}
			aria-current={activeSection === TRASH_SECTION.id ? 'page' : undefined}
		>
			<TRASH_SECTION.icon class="h-5 w-5" />
			<span class="text-[11px] leading-none whitespace-nowrap">{TRASH_SECTION.short}</span>
		</button>
	</div>
{:else}
	<!-- ── Vertical mode (desktop icon rail) ─────────────────────── -->
	<nav
		class="{alwaysVisible
			? 'flex'
			: 'hidden md:flex'} w-14 md:w-12 shrink-0 flex-col items-center gap-1 pt-2 border-r border-sidebar-border"
		style="background-color: var(--icon-rail); padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));"
		aria-label={$t('common.navigation', { default: 'Nawigacja główna' })}
	>
		<!-- New task -->
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						onclick={onNewTask}
						class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg text-sidebar-foreground
                   hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
						aria-label={$t('task.create.title')}
					>
						<SquarePlus class="h-6 w-6 md:h-5 md:w-5" />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right" sideOffset={6}>{$t('task.create.title')}</Tooltip.Content>
		</Tooltip.Root>

		<!-- Section icons -->
		{#each SECTIONS as s (s.id)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							onclick={() => {
								onSectionClick?.(s.id);
								activeSection = s.id;
							}}
							class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg transition-colors
                {activeSection === s.id
								? 'bg-sidebar-accent text-sidebar-accent-foreground'
								: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}"
							aria-label={s.label}
							aria-current={activeSection === s.id ? 'page' : undefined}
						>
							<span class="relative">
								<s.icon class="h-6 w-6 md:h-5 md:w-5" />
								{#if s.id === 'overdue' && $overdueTasks.length > 0}
									<span
										class="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center
											rounded-full text-[9px] font-bold leading-none text-white px-0.5"
										style="background-color: #FF8C42"
										aria-label="{$overdueTasks.length} {$t('taskList.filter.date.overdue')}"
									>
										{$overdueTasks.length > 99 ? '99+' : $overdueTasks.length}
									</span>
								{:else if s.id === 'today' && $todayTasks.length > 0}
									<span
										class="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center
											rounded-full text-[9px] font-bold leading-none text-white px-0.5"
										style="background-color: #FF8C42"
										aria-label="{$todayTasks.length} {$t('taskList.filter.date.today')}"
									>
										{$todayTasks.length > 99 ? '99+' : $todayTasks.length}
									</span>
								{:else if s.id === 'starred' && $starredTasks.length > 0}
									<span
										class="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center
											rounded-full bg-foreground/15 text-[9px] font-medium leading-none text-muted-foreground px-0.5"
										aria-label="{$starredTasks.length} {$t('taskList.filter.starred_only')}"
									>
										{$starredTasks.length > 99 ? '99+' : $starredTasks.length}
									</span>
								{:else if s.id === 'upcoming' && $upcomingTasks.length > 0}
									<span
										class="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center
											rounded-full bg-foreground/15 text-[9px] font-medium leading-none text-muted-foreground px-0.5"
										aria-label="{$upcomingTasks.length} {$t('taskList.filter.date.upcoming')}"
									>
										{$upcomingTasks.length > 99 ? '99+' : $upcomingTasks.length}
									</span>
								{:else if s.id === 'no_date' && $noDateTasks.length > 0}
									<span
										class="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center
											rounded-full bg-foreground/15 text-[9px] font-medium leading-none text-muted-foreground px-0.5"
										aria-label="{$noDateTasks.length} {$t('taskList.filter.date.no_date')}"
									>
										{$noDateTasks.length > 99 ? '99+' : $noDateTasks.length}
									</span>
								{/if}
							</span>
						</button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="right" sideOffset={6}>{s.label}</Tooltip.Content>
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
							onSectionClick?.(TRASH_SECTION.id);
							activeSection = TRASH_SECTION.id;
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
						aria-label={$t('settings.app_settings')}
					>
						<Settings class="h-6 w-6 md:h-5 md:w-5" />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="right" sideOffset={6}>{$t('settings.app_settings')}</Tooltip.Content>
		</Tooltip.Root>

		<!-- User avatar + menu -->
		{#if !loggingOut}
			{#if isMobileQuery.value}
				<button
					type="button"
					onclick={() => (userSheetOpen = true)}
					class="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors"
					aria-label={$t('common.user_menu', { default: 'Menu użytkownika' })}
				>
					<span
						class="flex h-8 w-8 md:h-7 md:w-7 select-none items-center justify-center rounded-full bg-primary/10
							text-xs font-semibold text-primary"
					>
						{getUserInitial($session.user?.username ?? null)}
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
								aria-label={$t('common.user_menu', { default: 'Menu użytkownika' })}
							>
								<span
									class="flex h-7 w-7 select-none items-center justify-center rounded-full bg-primary/10
										text-xs font-semibold text-primary"
								>
									{getUserInitial($session.user?.username ?? null)}
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
									{getUserInitial($session.user?.username ?? null)}
								</span>
								<div class="grid flex-1 text-start text-sm leading-tight">
									<span class="truncate font-medium">{$session.user?.username ?? '—'}</span>
									<span class="truncate text-xs text-muted-foreground"
										>{$t('common.e2ee_account', { default: 'Konto E2EE' })}</span
									>
								</div>
							</div>
						</DropdownMenu.Label>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Item onclick={() => goto('/settings')}>
								<Settings class="h-4 w-4" />
								{$t('settings.app_settings')}
							</DropdownMenu.Item>
						</DropdownMenu.Group>
						{#if $session.isAuthenticated}
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								onclick={handleLogout}
								class="text-destructive focus:text-destructive"
							>
								<LogOut class="h-4 w-4" />
								{$t('common.logout', { default: 'Wyloguj się' })}
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

<!-- Mobile: User menu Sheet -->
<Sheet bind:open={userSheetOpen}>
	<SheetContent side="bottom" class="h-auto">
		<SheetHeader>
			<SheetTitle>
				<div class="flex items-center gap-2">
					<span
						class="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full bg-primary/10
							text-xs font-semibold text-primary"
					>
						{getUserInitial($session.user?.username ?? null)}
					</span>
					<div class="grid flex-1 text-start text-sm leading-tight">
						<span class="truncate font-medium">{$session.user?.username ?? '—'}</span>
						<span class="truncate text-xs font-normal text-muted-foreground"
							>{$t('common.e2ee_account', { default: 'Konto E2EE' })}</span
						>
					</div>
				</div>
			</SheetTitle>
		</SheetHeader>
		<div class="mt-4 space-y-1">
			<Button
				variant="ghost"
				class="w-full justify-start"
				onclick={() => {
					userSheetOpen = false;
					goto('/settings');
				}}
			>
				<Settings class="mr-2 h-4 w-4" />
				{$t('settings.app_settings')}
			</Button>
			{#if $session.isAuthenticated}
				<Button
					variant="ghost"
					class="w-full justify-start text-destructive hover:text-destructive"
					onclick={() => {
						userSheetOpen = false;
						handleLogout();
					}}
				>
					<LogOut class="mr-2 h-4 w-4" />
					{$t('common.logout', { default: 'Wyloguj się' })}
				</Button>
			{/if}
		</div>
	</SheetContent>
</Sheet>
