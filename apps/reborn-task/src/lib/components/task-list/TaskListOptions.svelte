<script lang="ts">
	import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@reborn/ui';
	import { Edit, Star, Trash } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import type { ListDecrypted } from '@reborn/types';

	let {
		list,
		onEdit,
		onSetDefault,
		onDelete
	} = $props<{
		list: ListDecrypted;
		onEdit: () => void;
		onSetDefault: () => void;
		onDelete: () => void;
	}>();
</script>

<DropdownMenuContent align="end">
	<DropdownMenuItem onclick={onEdit}>
		<Edit class="mr-2 h-4 w-4" />
		{$t('taskList.edit_dialog.title')}
	</DropdownMenuItem>
	
	{#if !list.is_default}
		<DropdownMenuItem onclick={onSetDefault}>
			<Star class="mr-2 h-4 w-4" />
			{$t('taskList.set_as_default')}
		</DropdownMenuItem>
	{/if}

	<DropdownMenuSeparator />
	
	<DropdownMenuItem onclick={onDelete} class="text-destructive">
		<Trash class="mr-2 h-4 w-4" />
		{$t('common.delete')}
	</DropdownMenuItem>
</DropdownMenuContent>
