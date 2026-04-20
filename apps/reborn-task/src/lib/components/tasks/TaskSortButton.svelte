<!-- 
	@component
	Task Sort Button - Compact sort option selector with dropdown on desktop and sheet on mobile
-->
<script lang="ts">
	import {
		Button,
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuRadioGroup,
		DropdownMenuRadioItem,
		DropdownMenuTrigger,
		Sheet,
		SheetContent,
		SheetHeader,
		SheetTitle,
		cn
	} from '@reborn/ui';
	import { ArrowUpDown, ArrowDownAZ, Calendar, Clock } from '@lucide/svelte';
	import { taskSortStore, type TaskSortOption } from '$lib/stores/task-sort.store';
	import { t } from '$lib/stores/i18n.store';
	import { onMount } from 'svelte';

	interface Props {
		listId: string;
		class?: string;
	}

	let { listId, class: className = '' }: Props = $props();

	// State
	let isMobile = $state(false);
	let sheetOpen = $state(false);

	// Get current sort option for this list - reactive derived value
	// Using $taskSortStore directly in $derived makes it reactive
	let currentSortOption = $derived($taskSortStore[listId]?.option || 'due_date');

	// Sort options (without completion status)
	const sortOptions: Array<{ value: TaskSortOption; icon: typeof Calendar }> = [
		{ value: 'due_date', icon: Calendar },
		{ value: 'alphabetical', icon: ArrowDownAZ },
		{ value: 'created_date', icon: Clock }
	];

	// Get label for sort option
	function getSortLabel(option: TaskSortOption): string {
		return $t(`taskList.sort.${option}`);
	}

	// Handle sort change
	function handleSortChange(value: string) {
		taskSortStore.setListSort(listId, value as TaskSortOption);
		sheetOpen = false;
	}

	// Check if mobile on mount and resize
	onMount(() => {
		const checkMobile = () => {
			isMobile = window.innerWidth < 768;
		};

		checkMobile();
		window.addEventListener('resize', checkMobile);

		return () => {
			window.removeEventListener('resize', checkMobile);
		};
	});
</script>

{#if isMobile}
	<!-- Mobile: Button with Sheet -->
	<Button
		variant="ghost"
		size="icon"
		class={cn('h-8 w-8', className)}
		onclick={() => (sheetOpen = true)}
		aria-label={$t('taskList.sort.button_label')}
	>
		<ArrowUpDown class="h-4 w-4" />
	</Button>

	<Sheet bind:open={sheetOpen}>
		<SheetContent side="bottom" class="h-auto">
			<SheetHeader>
				<SheetTitle>{$t('taskList.sort.title')}</SheetTitle>
			</SheetHeader>
			<div class="mt-4 space-y-1">
				{#each sortOptions as option}
					<Button
						variant={currentSortOption === option.value ? 'secondary' : 'ghost'}
						class="w-full justify-start"
						onclick={() => handleSortChange(option.value)}
					>
						{@const Icon = option.icon}
						<Icon class="mr-2 h-4 w-4" />
						{getSortLabel(option.value)}
					</Button>
				{/each}
			</div>
		</SheetContent>
	</Sheet>
{:else}
	<!-- Desktop: Dropdown Menu -->
	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class={cn('h-8 w-8', className)}
					aria-label={$t('taskList.sort.button_label')}
				>
					<ArrowUpDown class="h-4 w-4" />
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-48">
			<DropdownMenuRadioGroup value={currentSortOption} onValueChange={handleSortChange}>
				{#each sortOptions as option}
					<DropdownMenuRadioItem value={option.value}>
						{@const Icon = option.icon}
						<Icon class="mr-2 h-4 w-4" />
						{getSortLabel(option.value)}
					</DropdownMenuRadioItem>
				{/each}
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	</DropdownMenu>
{/if}
