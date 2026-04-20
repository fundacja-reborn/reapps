<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
		Button,
		RadioGroup,
		RadioGroupItem,
		Label
	} from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { RotateCw } from '@lucide/svelte';

	let {
		open = $bindable(false),
		onConfirm,
		onCancel
	} = $props<{
		open: boolean;
		onConfirm: (option: 'this_and_future' | 'all') => void | Promise<void>;
		onCancel?: () => void;
	}>();

	let selectedOption = $state<'this_and_future' | 'all'>('this_and_future');
	let isConfirming = $state(false);

	async function handleConfirm() {
		isConfirming = true;
		try {
			await onConfirm(selectedOption);
			open = false;
		} finally {
			isConfirming = false;
		}
	}

	function handleCancel() {
		open = false;
		onCancel?.();
	}
</script>

<Dialog bind:open onOpenChange={(isOpen) => { if (!isOpen) handleCancel(); }}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<RotateCw class="h-5 w-5" />
				{$t('task.recurring_instance.edit_options_title')}
			</DialogTitle>
			<DialogDescription>
				{$t('task.recurring_instance.edit_options_description')}
			</DialogDescription>
		</DialogHeader>

		<div class="py-3">
			<RadioGroup bind:value={selectedOption}>
				<div class="flex items-center space-x-2 mb-3">
					<RadioGroupItem value="this_and_future" id="opt_this_and_future" />
					<Label for="opt_this_and_future" class="font-normal cursor-pointer">
						{$t('task.recurring_instance.edit_option_this_and_future')}
					</Label>
				</div>
				<div class="flex items-center space-x-2">
					<RadioGroupItem value="all" id="opt_all" />
					<Label for="opt_all" class="font-normal cursor-pointer">
						{$t('task.recurring_instance.edit_option_all')}
					</Label>
				</div>
			</RadioGroup>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={handleCancel} disabled={isConfirming}>
				{$t('common.cancel')}
			</Button>
			<Button onclick={handleConfirm} disabled={isConfirming} loading={isConfirming}>
				{$t('common.confirm')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
