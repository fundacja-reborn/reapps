<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$lib/utils/navigation';
	import { Skeleton, toastStore } from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { activeListStore } from '$lib/stores/active-list.store';
	import { listOperationsService } from '$lib/services/list-operations.service';
	import { session } from '$lib/stores/auth.store';
	import type { ListDecrypted } from '@reborn/types';
	import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
	import { createLogger } from '@reborn/utils';

	// Import task list components
	import {
		TaskListSheet,
		TaskListEmpty,
		DeleteListDialog,
		EditListNameModal
	} from '$lib/components/task-list';
	import { TaskList } from '$lib/components/tasks';
	import { layoutStore } from '$lib/stores/layout.store';
	import { onDestroy } from 'svelte';

	const logger = createLogger('task:list-page');

	let currentList = $state<ListDecrypted | null>(null);
	let isLoading = $state(true);

	// Mobile check
	const isMobileQuery = useIsMobile();
	const isMobile = $derived(isMobileQuery.value);

	// Dialog states
	let deleteDialogOpen = $state(false);
	let editDialogOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let taskListRef: TaskList | undefined = $state();

	// Listen for focus-quick-add event from layout (desktop: IconNav "+")
	function handleFocusQuickAdd() {
		taskListRef?.focusQuickAdd();
	}

	if (typeof window !== 'undefined') {
		window.addEventListener('focus-quick-add', handleFocusQuickAdd);
	}

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('focus-quick-add', handleFocusQuickAdd);
		}
	});

	// Handlers
	function handleEdit() {
		editDialogOpen = true;
		mobileMenuOpen = false;
	}

	function handleSetDefault() {
		if (currentList) {
			listOperationsService
				.setDefaultList(currentList.id)
				.then(() => {
					toastStore.success($t('taskList.success.updated'));
				})
				.catch((error) => {
					logger.error('Failed to set default list:', error);
					toastStore.error($t('taskList.errors.update_failed'));
				});
		}
		mobileMenuOpen = false;
	}

	function handleDelete() {
		deleteDialogOpen = true;
		mobileMenuOpen = false;
	}

	async function onListUpdate(name: string) {
		if (currentList) {
			try {
				// Update list locally using store
				await listOperationsService.updateList(currentList.id, { name });

				toastStore.success($t('taskList.success.updated'));
			} catch (error: unknown) {
				logger.error('Failed to update list:', error);
				toastStore.error($t('taskList.errors.update_failed'));
			}
		}
	}

	async function onListDelete(mode: 'with-tasks' | 'move-tasks', targetListId?: string) {
		// Delegate to parent layout handler instead of duplicating logic
		// This prevents conflicts and ensures single source of truth
		deleteDialogOpen = false;

		// The parent layout will handle the actual deletion and navigation
		// We just need to trigger it from here
		if (window.dispatchEvent) {
			// Dispatch custom event that parent can listen to
			const event = new CustomEvent('list-delete-request', {
				detail: { listId: currentList?.id, mode, targetListId },
				bubbles: true
			});
			window.dispatchEvent(event);
		}
	}

	// Find the current list based on route parameter
	$effect(() => {
		// Add guard to prevent running during navigation
		if (!$page || !$page.params) {
			return;
		}

		const listId = $page.params.listId;
		const lists = $decryptedLists;

		if (listId && lists.length > 0) {
			// Find list by route parameter
			const foundList = lists.find((list) => list.id === listId);
			if (foundList) {
				currentList = foundList;
				// Reset filters when switching lists
				layoutStore.resetTaskFilters();
			} else {
				// List not found - might have been deleted
				currentList = null;
			}
			isLoading = false;

			// DO NOT update active list store here - let the layout handle it
			// This prevents reactive loops during navigation
		} else if (lists.length > 0) {
			// Lists loaded but no matching list found
			isLoading = false;
			currentList = null;
		} else {
			// Still loading lists
			isLoading = true;
		}
	});
</script>

<div class="container mx-auto p-6 max-w-4xl">
	{#if isLoading}
		<!-- Loading skeleton -->
		<div class="space-y-4">
			<Skeleton class="h-8 w-64" />
			<Skeleton class="h-4 w-48" />
			<div class="mt-8">
				<Skeleton class="h-32 w-full" />
			</div>
		</div>
	{:else if currentList}
		<!-- Tasks list -->
		{#key currentList.id}
			<TaskList
				bind:this={taskListRef}
				listId={currentList.id}
				filters={$layoutStore.taskFilters}
			/>
		{/key}
	{:else}
		<!-- No list found -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-lg font-medium mb-2">{$t('taskList.select_list_info')}</p>
			<p class="text-sm text-muted-foreground">
				{$t('taskList.create_new')}
			</p>
		</div>
	{/if}
</div>

<!-- Mobile bottom sheet menu -->
{#if currentList}
	<TaskListSheet
		bind:open={mobileMenuOpen}
		list={currentList}
		onEdit={handleEdit}
		onSetDefault={handleSetDefault}
		onDelete={handleDelete}
	/>

	<!-- Dialogs -->
	<DeleteListDialog
		bind:open={deleteDialogOpen}
		list={currentList}
		allLists={$decryptedLists}
		onConfirm={onListDelete}
		onClose={() => {
			deleteDialogOpen = false;
		}}
	/>

	<EditListNameModal
		bind:open={editDialogOpen}
		list={currentList}
		onSave={onListUpdate}
		onClose={() => {
			editDialogOpen = false;
		}}
	/>
{/if}
