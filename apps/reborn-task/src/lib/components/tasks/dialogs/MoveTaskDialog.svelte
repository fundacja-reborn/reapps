<script lang="ts">
	import {
		Button,
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
		Sheet,
		SheetContent,
		SheetHeader,
		SheetTitle,
		SheetDescription
	} from '@reborn/ui';
	import { ArrowRight, Trash2, Circle, CircleCheck } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { decryptedLists } from '$lib/stores/decrypted-lists.store';
	import { useIsMobile } from '$lib/utils/mediaQuery.svelte';
	import type { TaskDecrypted } from '@reborn/types';

	let {
		open = $bindable(false),
		task,
		onMoveToList,
		onToggleCompleted,
		onDelete
	} = $props<{
		open: boolean;
		task: TaskDecrypted;
		onMoveToList: (listId: string) => Promise<void>;
		onToggleCompleted: () => Promise<void>;
		onDelete: () => void;
	}>();

	const isMobileQuery = useIsMobile();
	const isMobile = $derived(isMobileQuery.value);

	function handleClose() {
		open = false;
	}

	async function handleMoveToList(listId: string) {
		handleClose();
		await onMoveToList(listId);
	}
</script>

{#if isMobile}
	<!-- Mobile sheet -->
	<Sheet bind:open>
		<SheetContent side="bottom" class="rounded-t-lg">
			<SheetHeader>
				<SheetTitle>{$t('task.options')}</SheetTitle>
				<SheetDescription>
					{task.title}
				</SheetDescription>
			</SheetHeader>
			<div class="grid gap-2 py-4">
				<Button variant="ghost" size="lg" class="justify-start h-14" onclick={onToggleCompleted}>
					{#if task.is_completed}
						<Circle class="mr-3 h-5 w-5" />
						{$t('task.mark_incomplete')}
					{:else}
						<CircleCheck class="mr-3 h-5 w-5" />
						{$t('task.mark_complete')}
					{/if}
				</Button>

				<Button
					variant="ghost"
					size="lg"
					class="justify-start h-14"
					onclick={() => {
						// Show list selection
						handleClose();
						setTimeout(() => {
							open = true;
						}, 100);
					}}
				>
					<ArrowRight class="mr-3 h-5 w-5" />
					{$t('task.move_to_list')}
				</Button>

				<div class="my-2 h-px bg-border"></div>

				<Button
					variant="ghost"
					size="lg"
					class="justify-start h-14 text-destructive hover:text-destructive"
					onclick={() => {
						handleClose();
						onDelete();
					}}
				>
					<Trash2 class="mr-3 h-5 w-5" />
					{$t('common.delete')}
				</Button>
			</div>
		</SheetContent>
	</Sheet>
{:else}
	<!-- Desktop dialog -->
	<Dialog bind:open>
		<DialogContent>
			<DialogHeader>
				<DialogTitle>{$t('task.move_to_list')}</DialogTitle>
				<DialogDescription>
					{$t('task.move_to_list_description')}
				</DialogDescription>
			</DialogHeader>
			<div class="grid gap-2 py-4">
				{#each $decryptedLists as list}
					{#if list.id !== task.task_list_id}
						<Button
							variant="outline"
							class="justify-start"
							onclick={() => handleMoveToList(list.id)}
						>
							{list.name}
						</Button>
					{/if}
				{/each}
			</div>
			<DialogFooter>
				<Button variant="outline" onclick={handleClose}>
					{$t('common.cancel')}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
{/if}
