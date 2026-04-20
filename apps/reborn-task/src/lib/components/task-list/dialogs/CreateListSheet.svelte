<script lang="ts">
	import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, Button, Input } from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';

	let {
		open,
		onSubmit,
		onClose
	} = $props<{
		open: boolean;
		onSubmit: (name: string) => Promise<void>;
		onClose: () => void;
	}>();

	let newListName = $state('');
	let isCreating = $state(false);

	// Reset name when sheet opens
	$effect(() => {
		if (open) {
			newListName = '';
		}
	});

	async function handleSubmit() {
		if (!newListName.trim() || isCreating) return;
		
		isCreating = true;
		try {
			await onSubmit(newListName.trim());
			onClose();
		} finally {
			isCreating = false;
		}
	}
</script>

<Sheet open={open} onOpenChange={(isOpen) => {if (!isOpen) onClose();}}>
	<SheetContent>
		<SheetHeader>
			<SheetTitle>{$t('taskList.create_list')}</SheetTitle>
			<SheetDescription>
				{$t('taskList.create_description')}
			</SheetDescription>
		</SheetHeader>
		
		<div class="py-4">
			<Input
				type="text"
				placeholder={$t('taskList.name_placeholder')}
				bind:value={newListName}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !isCreating) {
						handleSubmit();
					}
				}}
				disabled={isCreating}
			/>
		</div>
		
		<SheetFooter>
			<Button
				type="button"
				variant="outline"
				onclick={() => onClose()}
				disabled={isCreating}
			>
				{$t('common.cancel')}
			</Button>
			<Button
				type="button"
				onclick={handleSubmit}
				disabled={!newListName.trim() || isCreating}
			>
				{isCreating ? $t('common.creating') : $t('common.create')}
			</Button>
		</SheetFooter>
	</SheetContent>
</Sheet>
