<script lang="ts">
	import {
		Folder,
		FolderOpen,
		Star,
		MoreVertical,
		Edit,
		Trash,
		Trash2,
		CheckCheck
	} from '@lucide/svelte';
	import * as Sidebar from '@reborn/ui';
	import { useSidebar } from '@reborn/ui/sidebar';
	import {
		ContextMenu,
		ContextMenuContent,
		ContextMenuItem,
		ContextMenuSeparator,
		ContextMenuTrigger
	} from '@reborn/ui';
	import type { ListDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { tick } from 'svelte';

	// Task counting store
	import { taskCounts } from '$lib/stores/task-counts.store';

	let {
		lists = [],
		activeListId = null,
		onListSelect = () => {},
		onListEdit = () => {},
		onListDelete = () => {},
		onSetDefault = () => {}
	} = $props<{
		lists: ListDecrypted[];
		activeListId: string | null;
		onListSelect: (listId: string) => void;
		onListEdit: (list: ListDecrypted) => void;
		onListDelete: (list: ListDecrypted) => void;
		onSetDefault: (list: ListDecrypted) => void;
	}>();

	// Get sidebar context
	const sidebar = useSidebar();

	// Sort lists
	let sortedLists = $derived(
		lists.sort((a: ListDecrypted, b: ListDecrypted) => a.order_index - b.order_index)
	);

	// Check if we have starred tasks or trash tasks
	let hasStarredTasks = $derived($taskCounts.starred > 0);
	let hasCompletedTasks = $derived($taskCounts.completed > 0);
	let hasTrashTasks = $derived($taskCounts.trash > 0);

	// Handle starred tasks "list"
	async function handleStarredClick() {
		onListSelect('starred');
		// Close sidebar on mobile after selection
		if (sidebar.isMobile) {
			await tick();
			sidebar.setOpenMobile(false);
		}
	}

	// Handle regular list click
	async function handleListClick(listId: string) {
		onListSelect(listId);
		// Close sidebar on mobile after selection
		if (sidebar.isMobile) {
			await tick();
			sidebar.setOpenMobile(false);
		}
	}
</script>

<Sidebar.SidebarGroup>
	<Sidebar.SidebarGroupLabel>{$t('task.sidebar.task_lists')}</Sidebar.SidebarGroupLabel>
	<Sidebar.SidebarGroupContent>
		<Sidebar.SidebarMenu>
			<!-- Starred tasks special list -->
			<Sidebar.SidebarMenuItem>
				<Sidebar.SidebarMenuButton
					isActive={activeListId === 'starred'}
					onclick={handleStarredClick}
					class="justify-between pr-1"
				>
					<div class="flex items-center gap-2 flex-1 min-w-0">
						<Star class="h-4 w-4 shrink-0" />
						<span class="truncate">{$t('task.sidebar.starred_tasks')}</span>
					</div>
					{#if hasStarredTasks}
						<span class="text-xs text-muted-foreground shrink-0 ml-2">{$taskCounts.starred}</span>
					{/if}
				</Sidebar.SidebarMenuButton>
			</Sidebar.SidebarMenuItem>

			<!-- Completed tasks special list -->
			{#if hasCompletedTasks || activeListId === 'completed'}
				<Sidebar.SidebarMenuItem>
					<Sidebar.SidebarMenuButton
						isActive={activeListId === 'completed'}
						onclick={() => handleListClick('completed')}
						class="justify-between pr-1"
					>
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<CheckCheck class="h-4 w-4 shrink-0" />
							<span class="truncate">{$t('task.sidebar.completed_tasks')}</span>
						</div>
						{#if hasCompletedTasks}
							<span class="text-xs text-muted-foreground shrink-0 ml-2"
								>{$taskCounts.completed}</span
							>
						{/if}
					</Sidebar.SidebarMenuButton>
				</Sidebar.SidebarMenuItem>
			{/if}

			<!-- Trash special list -->
			{#if hasTrashTasks || activeListId === 'trash'}
				<Sidebar.SidebarMenuItem>
					<Sidebar.SidebarMenuButton
						isActive={activeListId === 'trash'}
						onclick={() => handleListClick('trash')}
						class="justify-between pr-1"
					>
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<Trash2 class="h-4 w-4 shrink-0" />
							<span class="truncate">{$t('task.sidebar.trash')}</span>
						</div>
						{#if hasTrashTasks}
							<span class="text-xs text-muted-foreground shrink-0 ml-2">{$taskCounts.trash}</span>
						{/if}
					</Sidebar.SidebarMenuButton>
				</Sidebar.SidebarMenuItem>
			{/if}

			<!-- Regular task lists -->
			{#each sortedLists as list (list.id)}
				{@const taskCount = $taskCounts.byList[list.id] || 0}
				<Sidebar.SidebarMenuItem>
					<Sidebar.SidebarMenuButton
						isActive={list.id === activeListId}
						onclick={() => handleListClick(list.id)}
						class="justify-between pr-1"
					>
						<div class="flex items-center gap-2 flex-1 min-w-0">
							{#if list.id === activeListId}
								<FolderOpen class="h-4 w-4 shrink-0" />
							{:else}
								<Folder class="h-4 w-4 shrink-0" />
							{/if}
							<span class="truncate">{list.name}</span>
							{#if list.is_default}
								<Star class="h-3 w-3 text-yellow-500 shrink-0" />
							{/if}
						</div>
						{#if taskCount > 0}
							<span class="text-xs text-muted-foreground shrink-0 ml-2">{taskCount}</span>
						{/if}
					</Sidebar.SidebarMenuButton>
				</Sidebar.SidebarMenuItem>
			{/each}
		</Sidebar.SidebarMenu>
	</Sidebar.SidebarGroupContent>
</Sidebar.SidebarGroup>
