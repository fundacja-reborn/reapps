<script lang="ts">
	import * as Dialog from '@reborn/ui/components/dialog';
	import {
		Button,
		Checkbox,
		Alert,
		AlertDescription,
		RadioGroup,
		RadioGroupItem,
		Label
	} from '@reborn/ui';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '@reborn/ui';
	import { Trash2, AlertCircle } from '@lucide/svelte';
	import type { ListDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:delete-list');

	let {
		open = $bindable(false),
		list,
		allLists = [],
		onConfirm,
		onClose
	} = $props<{
		open: boolean;
		list: ListDecrypted | null;
		allLists: ListDecrypted[];
		onConfirm: (mode: 'with-tasks' | 'move-tasks', targetListId?: string) => Promise<void>;
		onClose: () => void;
	}>();

	// Delete mode selection
	let deleteMode = $state<'move-tasks' | 'with-tasks'>('move-tasks');
	let targetListId = $state<string>('');
	let confirmDeleteWithTasks = $state(false);
	let isDeleting = $state(false);

	// Available lists for moving tasks (excluding the list being deleted)
	let availableLists = $derived(allLists.filter((l: ListDecrypted) => l.id !== list?.id));

	// Reset state when dialog opens
	$effect(() => {
		if (open && availableLists.length > 0) {
			deleteMode = 'move-tasks';
			targetListId = availableLists[0].id;
			confirmDeleteWithTasks = false;
		}
	});

	// Check if can proceed with deletion
	let canDelete = $derived(
		deleteMode === 'move-tasks' ? targetListId !== '' : confirmDeleteWithTasks
	);

	async function handleConfirm() {
		if (!canDelete || !list) return;

		isDeleting = true;
		try {
			await onConfirm(deleteMode, targetListId || undefined);
			onClose();
		} catch (error: unknown) {
			logger.error('Failed to delete list:', error);
			// Error is handled by parent component
		} finally {
			isDeleting = false;
		}
	}

	function handleClose() {
		onClose();
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(isOpen) => {
		if (!isOpen) onClose();
	}}
>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Trash2 class="h-5 w-5 text-destructive" />
				{$t('taskList.delete_dialog.title')}
			</Dialog.Title>
			<Dialog.Description>
				{$t('taskList.delete_dialog.description', { values: { name: list?.name || '' } })}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<!-- Warning about E2E encryption -->
			<Alert variant="destructive">
				<AlertCircle class="h-4 w-4" />
				<AlertDescription>
					{$t('taskList.delete_dialog.e2e_warning')}
				</AlertDescription>
			</Alert>

			{#if availableLists.length > 0}
				<!-- Delete mode selection -->
				<RadioGroup bind:value={deleteMode}>
					<div class="space-y-3">
						<div class="flex items-start space-x-3">
							<RadioGroupItem value="move-tasks" id="move-tasks" class="mt-1" />
							<Label for="move-tasks" class="flex-1 cursor-pointer">
								<div class="font-medium">{$t('taskList.delete_dialog.move_tasks')}</div>
								<div class="text-sm text-muted-foreground">
									{$t('taskList.delete_dialog.move_tasks_description')}
								</div>
							</Label>
						</div>

						{#if deleteMode === 'move-tasks'}
							<div class="ml-6 mt-2">
								<Select type="single" bind:value={targetListId}>
									<SelectTrigger class="w-full">
										{availableLists.find(
											(l: { id: string; name: string; is_default?: boolean }) =>
												l.id === targetListId
										)?.name || $t('taskList.select_list')}
									</SelectTrigger>
									<SelectContent>
										{#each availableLists as targetList (targetList.id)}
											<SelectItem value={targetList.id}>
												{targetList.name}
												{#if targetList.is_default}
													<span class="text-muted-foreground ml-1">({$t('taskList.default')})</span>
												{/if}
											</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
						{/if}

						<div class="flex items-start space-x-3">
							<RadioGroupItem value="with-tasks" id="with-tasks" class="mt-1" />
							<Label for="with-tasks" class="flex-1 cursor-pointer">
								<div class="font-medium text-destructive">
									{$t('taskList.delete_dialog.delete_with_tasks')}
								</div>
								<div class="text-sm text-muted-foreground">
									{$t('taskList.delete_dialog.delete_with_tasks_description')}
								</div>
							</Label>
						</div>

						{#if deleteMode === 'with-tasks'}
							<div class="ml-6 mt-2 p-3 bg-destructive/10 rounded-md">
								<div class="flex items-start space-x-2">
									<Checkbox
										id="confirm-delete"
										bind:checked={confirmDeleteWithTasks}
										class="mt-0.5"
									/>
									<Label for="confirm-delete" class="text-sm text-destructive cursor-pointer">
										{$t('taskList.delete_dialog.confirm_delete_with_tasks')}
									</Label>
								</div>
							</div>
						{/if}
					</div>
				</RadioGroup>
			{:else}
				<!-- No other lists available - must delete with tasks -->
				<Alert variant="destructive">
					<AlertCircle class="h-4 w-4" />
					<AlertDescription>
						{$t('taskList.delete_dialog.no_other_lists')}
					</AlertDescription>
				</Alert>

				<div class="p-3 bg-destructive/10 rounded-md">
					<div class="flex items-start space-x-2">
						<Checkbox
							id="confirm-delete-only"
							bind:checked={confirmDeleteWithTasks}
							class="mt-0.5"
						/>
						<Label for="confirm-delete-only" class="text-sm text-destructive cursor-pointer">
							{$t('taskList.delete_dialog.confirm_delete_with_tasks')}
						</Label>
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={handleClose} disabled={isDeleting}>
				{$t('common.cancel')}
			</Button>
			<Button variant="destructive" disabled={!canDelete || isDeleting} onclick={handleConfirm}>
				{#if isDeleting}
					<span class="flex items-center gap-2">
						<span
							class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
						></span>
						{$t('common.deleting')}
					</span>
				{:else}
					{$t('taskList.delete_dialog.confirm')}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
