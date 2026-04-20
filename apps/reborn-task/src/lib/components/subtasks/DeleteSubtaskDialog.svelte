<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		Button
	} from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';

	let {
		open = $bindable(false),
		subtaskTitle,
		onConfirm,
		onCancel = () => {}
	} = $props<{
		open?: boolean;
		subtaskTitle: string;
		onConfirm: () => void | Promise<void>;
		onCancel?: () => void;
	}>();

	let isDeleting = $state(false);

	async function handleConfirm() {
		isDeleting = true;
		
		try {
			await onConfirm();
		} finally {
			isDeleting = false;
		}
	}

	function handleCancel() {
		if (!isDeleting) {
			open = false;
			onCancel();
		}
	}
</script>

<Dialog bind:open>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{$t('task.subtasks.delete_title')}</DialogTitle>
			<DialogDescription>
				{$t('task.subtasks.delete_description',{ values: { title: subtaskTitle } })}
			</DialogDescription>
		</DialogHeader>
		
		<DialogFooter>
			<Button
				variant="outline"
				onclick={handleCancel}
				disabled={isDeleting}
			>
				{$t('common.cancel')}
			</Button>
			<Button
				variant="destructive"
				onclick={handleConfirm}
				disabled={isDeleting}
			>
				{#if isDeleting}
					{$t('common.deleting')}...
				{:else}
					{$t('common.delete')}
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
