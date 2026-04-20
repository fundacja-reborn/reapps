<script lang="ts">
	import { toastStore, Progress, cn } from '@reborn/ui';
	import SubtaskItem from './SubtaskItem.svelte';
	import AddSubtask from './AddSubtask.svelte';
	import DeleteSubtaskDialog from './DeleteSubtaskDialog.svelte';
	import { t } from '$lib/stores/i18n.store';
	import { decryptedSubtasksByTask } from '$lib/stores/decrypted-subtasks.store';
	import { subtaskOperationsService } from '$lib/services/subtask-operations.service';
	import type { Subtask } from '@reborn/types';
	import { createLogger } from '@reborn/utils';
	import { dndzone } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import { fade } from 'svelte/transition';
	import { untrack } from 'svelte';

	const logger = createLogger('SubtaskList');

	let {
		taskId,
		disabled = false,
		class: className = ''
	} = $props<{
		taskId: string;
		disabled?: boolean;
		class?: string;
	}>();

	// Get reactive subtasks store for this task
	const subtasksStore = decryptedSubtasksByTask(untrack(() => taskId));

	// Local mutable copy for drag & drop
	let dragItems = $state<Subtask[]>([]);

	// Sync dragItems with store
	$effect(() => {
		const storeSubtasks = $subtasksStore;
		// Only update if not currently dragging
		if (!isDragEnabled) {
			dragItems = [...storeSubtasks];
		}
		logger.debug('SubtaskList - subtasks changed:', {
			taskId,
			count: storeSubtasks.length,
			subtasks: storeSubtasks.map((st) => ({ id: st.id, title: st.title }))
		});
	});

	// Use store value for non-drag operations
	let subtasks = $derived($subtasksStore);

	// State
	let isLoading = $state(false);
	let deleteDialogOpen = $state(false);
	let subtaskToDelete = $state<Subtask | null>(null);
	let editingSubtaskId = $state<string | null>(null);
	let deletingSubtaskId = $state<string | null>(null);

	// Drag & Drop state
	let isDragEnabled = $state(false);
	let draggedItemId = $state<string | null>(null);
	let longPressTimer: NodeJS.Timeout | null = null;
	const LONG_PRESS_DURATION = 300; // 300ms for long press

	// Computed values
	let completedCount = $derived(subtasks.filter((st) => st.is_completed).length);
	let progress = $derived(
		subtasks.length > 0 ? Math.round((completedCount / subtasks.length) * 100) : 0
	);

	// Handlers
	async function handleAddSubtask(title: string) {
		try {
			isLoading = true;
			// Reset any active editing
			editingSubtaskId = null;

			await subtaskOperationsService.createSubtask(taskId, title);

			// Small delay to ensure database updates are complete
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Wait for reactive updates to complete
			const { tick } = await import('svelte');
			await tick();

			toastStore.success($t('task.subtasks.created'));
		} catch (error: unknown) {
			logger.error('Failed to create subtask:', error);
			toastStore.error($t('task.subtasks.create_failed'));
		} finally {
			isLoading = false;
		}
	}

	async function handleToggleComplete(subtask: Subtask, completed: boolean) {
		try {
			// Reset editing state when toggling completion
			if (editingSubtaskId === subtask.id) {
				editingSubtaskId = null;
			}

			await subtaskOperationsService.toggleSubtaskCompletion(subtask.id);

			toastStore.success(
				completed ? $t('task.subtasks.marked_complete') : $t('task.subtasks.marked_incomplete')
			);
		} catch (error: unknown) {
			logger.error('Failed to toggle subtask completion:', error);
			toastStore.error($t('task.subtasks.update_failed'));
		}
	}

	async function handleTitleChange(subtask: Subtask, newTitle: string) {
		try {
			await subtaskOperationsService.updateSubtaskTitle(subtask.id, newTitle);
			toastStore.success($t('task.subtasks.updated'));
			// End editing after successful save
			editingSubtaskId = null;
		} catch (error: unknown) {
			logger.error('Failed to update subtask title:', error);
			toastStore.error($t('task.subtasks.update_failed'));
		}
	}

	function handleDeleteRequest(subtask: Subtask) {
		subtaskToDelete = subtask;
		deletingSubtaskId = subtask.id;
		deleteDialogOpen = true;
	}

	async function handleDeleteConfirm() {
		if (!subtaskToDelete) return;

		try {
			await subtaskOperationsService.deleteSubtask(subtaskToDelete.id);
			toastStore.success($t('task.subtasks.deleted'));

			// Reset editing state if deleted subtask was being edited
			if (editingSubtaskId === subtaskToDelete.id) {
				editingSubtaskId = null;
			}

			subtaskToDelete = null;
			deletingSubtaskId = null;
			deleteDialogOpen = false;
		} catch (error: unknown) {
			logger.error('Failed to delete subtask:', error);
			toastStore.error($t('task.subtasks.delete_failed'));
		}
	}

	function handleDeleteCancel() {
		subtaskToDelete = null;
		deletingSubtaskId = null;
		deleteDialogOpen = false;
	}

	function handleEditStart(subtaskId: string) {
		editingSubtaskId = subtaskId;
	}

	function handleEditEnd() {
		editingSubtaskId = null;
	}

	// Drag & Drop handlers
	function handlePointerDown(subtaskId: string): (e: PointerEvent) => void {
		return (e: PointerEvent) => {
			// Only handle touch or primary mouse button
			if (e.pointerType === 'mouse' && e.button !== 0) return;

			// Clear any existing timer
			if (longPressTimer) {
				clearTimeout(longPressTimer);
			}

			// Start long press timer
			longPressTimer = setTimeout(() => {
				isDragEnabled = true;
				draggedItemId = subtaskId;
				// Haptic feedback for mobile (if supported)
				if ('vibrate' in navigator) {
					navigator.vibrate(50);
				}
			}, LONG_PRESS_DURATION);
		};
	}

	function handlePointerUp() {
		// Clear long press timer
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function handleDndConsider(e: CustomEvent<{ items: Subtask[] }>) {
		// Update local state during drag
		dragItems = e.detail.items;
	}

	async function handleDndFinalize(e: CustomEvent<{ items: Subtask[] }>) {
		try {
			// Log what we received from dnd library
			logger.debug('DnD finalize event received', {
				finalOrder: e.detail.items.map((item, index) => ({
					index,
					id: item.id,
					title: item.title
				})),
				originalOrder: $subtasksStore.map((item, index) => ({
					index,
					id: item.id,
					title: item.title
				}))
			});

			// Update local state with final order immediately
			dragItems = e.detail.items;

			// Call service with the new order
			await subtaskOperationsService.handleSubtaskReorder(e.detail.items);

			// Wait for store updates to propagate
			const { tick } = await import('svelte');
			await tick();

			// Disable drag mode
			isDragEnabled = false;
			draggedItemId = null;

			toastStore.success($t('task.subtasks.reordered'));
		} catch (error: unknown) {
			logger.error('Failed to reorder subtasks:', error);
			toastStore.error($t('task.subtasks.reorder_failed'));
			// Disable drag mode and let store sync naturally
			isDragEnabled = false;
			draggedItemId = null;
		}
	}

	// Clean up on unmount
	$effect(() => {
		return () => {
			if (longPressTimer) {
				clearTimeout(longPressTimer);
			}
		};
	});
</script>

<div class={cn('space-y-2', className)}>
	<!-- Progress indicator -->
	{#if subtasks.length > 0}
		<div class="space-y-1 mt-7">
			<div class="flex items-center justify-between text-sm">
				<span class="text-muted-foreground">{$t('task.subtasks.title')}</span>
				<span class="text-muted-foreground">
					{completedCount} / {subtasks.length}
				</span>
			</div>
			<Progress value={progress} class="h-2" />
		</div>
	{/if}

	<!-- Subtasks list -->
	{#if dragItems.length > 0}
		<div
			class="space-y-0.5"
			use:dndzone={{
				items: dragItems,
				dragDisabled: !isDragEnabled || disabled || isLoading,
				flipDurationMs: 200,
				dropTargetStyle: {},
				morphDisabled: true,
				dropFromOthersDisabled: true
			}}
			onconsider={handleDndConsider}
			onfinalize={handleDndFinalize}
		>
			{#each dragItems as subtask (subtask.id)}
				<div
					animate:flip={{ duration: 200 }}
					class={cn('relative', draggedItemId === subtask.id && 'opacity-50')}
				>
					<SubtaskItem
						{subtask}
						isEditing={editingSubtaskId === subtask.id}
						isDeleting={deletingSubtaskId === subtask.id}
						disabled={disabled || isLoading}
						{isDragEnabled}
						onPointerDown={handlePointerDown(subtask.id)}
						onPointerUp={handlePointerUp}
						onPointerCancel={handlePointerUp}
						onComplete={(checked) => handleToggleComplete(subtask, checked)}
						onTitleChange={(title) => handleTitleChange(subtask, title)}
						onDelete={() => handleDeleteRequest(subtask)}
						onEditStart={() => handleEditStart(subtask.id)}
						onEditEnd={handleEditEnd}
					/>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Add new subtask -->
	<AddSubtask
		disabled={disabled || isLoading}
		placeholder={$t('task.subtasks.add_placeholder')}
		onAdd={handleAddSubtask}
	/>

	<!-- Delete confirmation dialog -->
	<DeleteSubtaskDialog
		bind:open={deleteDialogOpen}
		subtaskTitle={subtaskToDelete?.title || ''}
		onConfirm={handleDeleteConfirm}
		onCancel={handleDeleteCancel}
	/>
</div>
