<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
		Button,
		toastStore,
		RadioGroup,
		RadioGroupItem,
		Label
	} from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { Trash2 } from '@lucide/svelte';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:delete-task');

	let {
		open = $bindable(false),
		taskTitle = '',
		isRecurringInstance = false,
		onConfirm,
		onClose
	} = $props<{
		open: boolean;
		taskTitle: string;
		isRecurringInstance?: boolean;
		onConfirm: (option?: 'this_only' | 'future') => void | Promise<void>;
		onClose: () => void;
	}>();

	let isDeleting = $state(false);
	let deleteOption = $state<'this_only' | 'future'>('this_only');

	async function handleConfirm() {
		isDeleting = true;

		try {
			if (isRecurringInstance) {
				await onConfirm(deleteOption);
			} else {
				await onConfirm();
			}
			onClose();
		} catch (error: unknown) {
			// Error handling is done in parent component
			logger.error('Delete task error:', error);
		} finally {
			isDeleting = false;
		}
	}

	function handleCancel() {
		onClose();
	}
</script>

<Dialog
	{open}
	onOpenChange={(isOpen) => {
		if (!isOpen) onClose();
	}}
>
	<DialogContent>
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<Trash2 class="h-5 w-5 text-destructive" />
				{$t('task.delete.title')}
			</DialogTitle>
			<DialogDescription>
				{$t('task.delete.confirm_message', { values: { title: taskTitle } })}
			</DialogDescription>
		</DialogHeader>

		{#if isRecurringInstance}
			<div class="py-4">
				<RadioGroup bind:value={deleteOption}>
					<div class="flex items-center space-x-2 mb-3">
						<RadioGroupItem value="this_only" id="this_only" />
						<Label for="this_only" class="font-normal cursor-pointer">
							{$t('task.delete.this_only')}
						</Label>
					</div>
					<div class="flex items-center space-x-2">
						<RadioGroupItem value="future" id="future" />
						<Label for="future" class="font-normal cursor-pointer">
							{$t('task.delete.future')}
						</Label>
					</div>
				</RadioGroup>
			</div>
		{/if}

		<DialogFooter>
			<Button variant="outline" onclick={handleCancel} disabled={isDeleting}>
				{$t('common.cancel')}
			</Button>
			<Button
				variant="destructive"
				onclick={handleConfirm}
				disabled={isDeleting}
				loading={isDeleting}
			>
				{$t('common.delete')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
