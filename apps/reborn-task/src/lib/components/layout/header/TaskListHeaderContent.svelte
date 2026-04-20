<!--
	@component
	Task list header content - displays list name, sort options and actions
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '@reborn/ui';
	import * as DropdownMenu from '@reborn/ui/components/dropdown-menu';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
	import { MoreVertical, Plus } from '@lucide/svelte';
	import type { ListDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { layoutStore } from '$lib/stores/layout.store';
	import { listOperationsService } from '$lib/services/list-operations.service';
	import { TaskSortButton, TaskFilterBar } from '$lib/components/tasks';
	import { toastStore } from '@reborn/ui';
	import type { TaskFilters } from '$lib/services/task-filtering.service';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:list-header');

	interface Props {
		list: ListDecrypted | null;
		filters?: TaskFilters;
		onFiltersChange?: (filters: TaskFilters) => void;
		onAddTask?: () => void;
		children?: Snippet;
		actions?: Snippet;
	}

	let { list, filters = { option: 'all' }, onFiltersChange, onAddTask, children, actions }: Props = $props();

	function handleFiltersChange(newFilters: TaskFilters) {
		onFiltersChange?.(newFilters);
	}

	// State for mobile sheet
	let mobileMenuOpen = $state(false);

	async function handleSetDefaultList(listId: string) {
		try {
			await listOperationsService.setDefaultList(listId);
			toastStore.success($t('taskList.success.default_set'));
		} catch (error: unknown) {
			logger.error('Failed to set default list:', error);
			const errorMessage = error instanceof Error ? error.message : $t('error.unknown');
			toastStore.error($t('taskList.errors.default_set_failed'), {
				description: errorMessage
			});
		}
	}

	// Check if mobile
	let isMobile = $state(false);
	$effect(() => {
		if (typeof window !== 'undefined') {
			isMobile = window.innerWidth < 768;
			const handleResize = () => {
				isMobile = window.innerWidth < 768;
			};
			window.addEventListener('resize', handleResize);
			return () => window.removeEventListener('resize', handleResize);
		}
	});
</script>

{#if list}
	<div class="flex items-center justify-between w-full min-w-0 overflow-hidden">
		<!-- List name (left aligned) -->
		<div class="flex items-center gap-4 flex-1 min-w-0 overflow-hidden">
			<h1
				class="text-sm font-medium truncate max-w-[52vw] md:max-w-[350px] min-w-0 block"
				style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;"
			>
				{list.name}
			</h1>
		</div>

		<!-- Sort, filter and menu (right aligned) -->
		<div class="flex items-center gap-2 flex-shrink-0">
			<!-- Add task button -->
			<Button variant="ghost" size="icon" class="h-9 w-9" onclick={onAddTask} aria-label={$t('task.quick_add.placeholder')}>
				<Plus class="h-4 w-4" />
			</Button>

			<!-- Filter button -->
			<TaskFilterBar {filters} onChange={handleFiltersChange} />

			<!-- Sort button -->
			<TaskSortButton listId={list.id} />

			<!-- Options menu -->
			{#if isMobile}
				<!-- Mobile: Use Sheet -->
				<Button variant="ghost" size="icon" class="h-9 w-9" onclick={() => (mobileMenuOpen = true)}>
					<MoreVertical class="h-4 w-4" />
					<span class="sr-only">{$t('taskList.menu_aria_label')}</span>
				</Button>
			{:else}
				<!-- Desktop: Use DropdownMenu with snippets -->
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon" class="h-9 w-9">
								<MoreVertical class="h-4 w-4" />
								<span class="sr-only">{$t('taskList.menu_aria_label')}</span>
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-48">
						<DropdownMenu.Item
							onclick={() => {
								layoutStore.openEditDialog(list);
							}}
						>
							{$t('taskList.edit_name')}
						</DropdownMenu.Item>
						{#if !list.is_default}
							<DropdownMenu.Item onclick={() => handleSetDefaultList(list.id)}>
								{$t('taskList.set_as_default')}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							class="text-destructive focus:text-destructive"
							onclick={() => {
								layoutStore.openDeleteDialog(list);
							}}
						>
							{$t('taskList.delete')}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</div>
{:else}
	<!-- Fallback when no list is selected -->
	<div class="flex items-center justify-between w-full">
		<h1 class="text-lg font-semibold">{$t('taskList.select_list')}</h1>
	</div>
{/if}

{#if actions}
	{@render actions()}
{/if}

<!-- Mobile menu sheet -->
{#if list}
	<Sheet bind:open={mobileMenuOpen}>
		<SheetContent side="bottom" class="h-auto">
			<SheetHeader>
				<SheetTitle>{$t('taskList.options')}</SheetTitle>
			</SheetHeader>
			<div class="flex flex-col gap-2 mt-4">
				<Button
					variant="ghost"
					class="justify-start"
					onclick={() => {
						mobileMenuOpen = false;
						layoutStore.openEditDialog(list);
					}}
				>
					{$t('taskList.edit_name')}
				</Button>
				{#if !list.is_default}
					<Button
						variant="ghost"
						class="justify-start"
						onclick={() => {
							mobileMenuOpen = false;
							handleSetDefaultList(list.id);
						}}
					>
						{$t('taskList.set_as_default')}
					</Button>
				{/if}
				<div class="h-px bg-border my-2"></div>
				<Button
					variant="ghost"
					class="justify-start text-destructive hover:text-destructive"
					onclick={() => {
						mobileMenuOpen = false;
						layoutStore.openDeleteDialog(list);
					}}
				>
					{$t('taskList.delete')}
				</Button>
			</div>
		</SheetContent>
	</Sheet>
{/if}
