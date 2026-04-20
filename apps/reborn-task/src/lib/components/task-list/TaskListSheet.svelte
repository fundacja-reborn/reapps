<script lang="ts">
	import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, Button, Separator } from '@reborn/ui';
	import { Edit, Star, Trash } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import type { ListDecrypted } from '@reborn/types';

	let {
		open = $bindable(),
		list,
		onEdit,
		onSetDefault,
		onDelete
	} = $props<{
		open: boolean;
		list: ListDecrypted;
		onEdit: () => void;
		onSetDefault: () => void;
		onDelete: () => void;
	}>();
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="rounded-t-lg">
		<SheetHeader>
			<SheetTitle>{$t('taskList.options')}</SheetTitle>
			<SheetDescription>
				{list.name}
			</SheetDescription>
		</SheetHeader>
		<div class="grid gap-2 py-4">
			<Button
				variant="ghost"
				size="lg"
				class="justify-start h-14"
				onclick={onEdit}
			>
				<Edit class="mr-3 h-5 w-5" />
				{$t('taskList.edit_dialog.title')}
			</Button>
			
			{#if !list.is_default}
				<Button
					variant="ghost"
					size="lg"
					class="justify-start h-14"
					onclick={onSetDefault}
				>
					<Star class="mr-3 h-5 w-5" />
					{$t('taskList.set_as_default')}
				</Button>
			{/if}
			
			<Separator class="my-2" />
			
			{#if !list.is_default}
				<Button
					variant="ghost"
					size="lg"
					class="justify-start h-14 text-destructive hover:text-destructive"
					onclick={onDelete}
				>
					<Trash class="mr-3 h-5 w-5" />
					{$t('common.delete')}
				</Button>
			{/if}
		</div>
	</SheetContent>
</Sheet>
