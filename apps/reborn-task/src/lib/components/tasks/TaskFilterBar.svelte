<!--
	@component
	Task Filter Button — compact single-select filter (one of many).
	Shows icon + active filter label; on mobile opens a bottom Sheet, on desktop a Dropdown.
-->
<script lang="ts">
	import {
		Button,
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuRadioGroup,
		DropdownMenuRadioItem,
		DropdownMenuTrigger,
		Sheet,
		SheetContent,
		SheetHeader,
		SheetTitle
	} from '@reborn/ui';
	import { Filter, Star, AlertCircle, Sun, ChevronRight, CalendarOff } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { cn } from '@reborn/ui/utils';
	import { onMount } from 'svelte';

	import type { FilterOption, TaskFilters } from '$lib/services/task-filtering.service';

	let {
		filters = $bindable<TaskFilters>({ option: 'all' }),
		onChange,
		class: className = ''
	} = $props<{
		filters?: TaskFilters;
		onChange?: (filters: TaskFilters) => void;
		class?: string;
	}>();

	let isMobile = $state(false);
	let sheetOpen = $state(false);

	let isActive = $derived(filters.option !== 'all');

	const filterOptions: Array<{ value: FilterOption; icon: typeof Filter; labelKey: string }> = [
		{ value: 'all', icon: Filter, labelKey: 'taskList.filter.all' },
		{ value: 'starred', icon: Star, labelKey: 'taskList.filter.starred_only' },
		{ value: 'overdue', icon: AlertCircle, labelKey: 'taskList.filter.date.overdue' },
		{ value: 'today', icon: Sun, labelKey: 'taskList.filter.date.today' },
		{ value: 'upcoming', icon: ChevronRight, labelKey: 'taskList.filter.date.upcoming' },
		{ value: 'no_date', icon: CalendarOff, labelKey: 'taskList.filter.date.no_date' }
	];

	let activeLabel = $derived(
		isActive
			? $t(filterOptions.find((o) => o.value === filters.option)?.labelKey ?? 'taskList.filter.all')
			: null
	);

	function handleChange(value: string) {
		const newFilters = { option: value as FilterOption };
		filters = newFilters;
		onChange?.(newFilters);
		sheetOpen = false;
	}

	onMount(() => {
		const check = () => {
			isMobile = window.innerWidth < 768;
		};
		check();
		window.addEventListener('resize', check);
		return () => window.removeEventListener('resize', check);
	});
</script>

{#if isMobile}
	<button
		type="button"
		class={cn(
			'flex items-center gap-1.5 h-8 rounded-md px-2 transition-colors',
			isActive
				? 'text-primary hover:text-primary/80'
				: 'text-muted-foreground hover:text-foreground',
			className
		)}
		onclick={() => (sheetOpen = true)}
		aria-label={$t('taskList.filter.button_label')}
	>
		{#if activeLabel}
			<span class="text-xs font-medium">{activeLabel}</span>
		{/if}
		<Filter class="h-4 w-4 shrink-0" />
	</button>

	<Sheet bind:open={sheetOpen}>
		<SheetContent side="bottom" class="h-auto">
			<SheetHeader>
				<SheetTitle>{$t('taskList.filter.title')}</SheetTitle>
			</SheetHeader>
			<div class="mt-4 space-y-1">
				{#each filterOptions as opt}
					<Button
						variant={filters.option === opt.value ? 'secondary' : 'ghost'}
						class="w-full justify-start"
						onclick={() => handleChange(opt.value)}
					>
						{@const Icon = opt.icon}
						<Icon
							class={cn(
								'mr-2 h-4 w-4',
								opt.value === 'starred' &&
									filters.option === 'starred' &&
									'fill-current text-yellow-500'
							)}
						/>
						{$t(opt.labelKey)}
					</Button>
				{/each}
			</div>
		</SheetContent>
	</Sheet>
{:else}
	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={cn(
						'flex items-center gap-1.5 h-8 rounded-md px-2 transition-colors',
						isActive
							? 'text-primary hover:text-primary/80'
							: 'text-muted-foreground hover:text-foreground',
						className
					)}
					aria-label={$t('taskList.filter.button_label')}
				>
					{#if activeLabel}
						<span class="text-xs font-medium">{activeLabel}</span>
					{/if}
					<Filter class="h-4 w-4 shrink-0" />
				</button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-48">
			<DropdownMenuRadioGroup value={filters.option} onValueChange={handleChange}>
				{#each filterOptions as opt}
					<DropdownMenuRadioItem value={opt.value}>
						{@const Icon = opt.icon}
						<Icon
							class={cn(
								'mr-2 h-4 w-4',
								opt.value === 'starred' &&
									filters.option === 'starred' &&
									'fill-current text-yellow-500'
							)}
						/>
						{$t(opt.labelKey)}
					</DropdownMenuRadioItem>
				{/each}
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	</DropdownMenu>
{/if}
