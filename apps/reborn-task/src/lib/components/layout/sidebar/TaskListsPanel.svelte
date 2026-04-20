<!--
  @component
  Task lists panel for sidebar.
  Shows regular task lists with counts, context menu for edit/delete/set-default.
  Used when icon rail section is 'lists'.
-->
<script lang="ts">
	import { Folder, FolderOpen, Star, Plus } from '@lucide/svelte';
	import {
		ContextMenu,
		ContextMenuContent,
		ContextMenuItem,
		ContextMenuSeparator,
		ContextMenuTrigger
	} from '@reborn/ui';
	import type { ListDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { taskCounts } from '$lib/stores/task-counts.store';
	import { sessionExpired } from '$lib/stores/session-expired.store';

	let {
		lists = [],
		activeListId = null,
		onListSelect,
		onListCreate,
		onListEdit,
		onListDelete,
		onSetDefault
	}: {
		lists: ListDecrypted[];
		activeListId?: string | null;
		onListSelect: (listId: string) => void;
		onListCreate: () => void;
		onListEdit: (list: ListDecrypted) => void;
		onListDelete: (list: ListDecrypted) => void;
		onSetDefault: (list: ListDecrypted) => void;
	} = $props();

	let sortedLists = $derived([...lists].sort((a, b) => a.order_index - b.order_index));
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex h-12 md:h-10 shrink-0 items-center gap-1 pl-5 pr-2.5">
		<span class="min-w-0 flex-1 truncate text-base md:text-sm font-normal">
			{$t('task.sidebar.task_lists')}
		</span>
		<button
			type="button"
			onclick={onListCreate}
			title={$t('taskList.create_new')}
			aria-label={$t('taskList.create_new')}
			class="flex h-9 w-9 md:h-7 md:w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground
             transition-colors hover:bg-accent hover:text-accent-foreground"
		>
			<Plus class="h-5 w-5 md:h-4 md:w-4" />
		</button>
	</div>

	<!-- Lists -->
	<div class="flex-1 overflow-y-auto px-2">
		{#if sortedLists.length === 0}
			<div class="px-4 py-8 text-center">
				{#if $sessionExpired}
					<p class="text-sm text-muted-foreground">
						{$t('auth.session.empty_no_data')}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						{$t('taskList.empty', { default: 'Brak list' })}
					</p>
					<button
						type="button"
						onclick={onListCreate}
						class="mt-2 text-xs text-primary underline-offset-4 hover:underline"
					>
						{$t('taskList.create_new')}
					</button>
				{/if}
			</div>
		{:else}
			<ul class="flex flex-col gap-0.5 py-1">
				{#each sortedLists as list (list.id)}
					{@const taskCount = $taskCounts.byList[list.id] || 0}
					{@const isActive = list.id === activeListId}
					<li>
						<ContextMenu>
							<ContextMenuTrigger>
								<button
									type="button"
									onclick={() => onListSelect(list.id)}
									class="flex w-full items-center gap-2 rounded-md px-3 py-3 md:py-2 text-base md:text-sm transition-colors
                    {isActive
										? 'bg-accent text-accent-foreground'
										: 'text-foreground hover:bg-accent/50'}"
								>
									<div class="flex items-center gap-2 flex-1 min-w-0">
										{#if isActive}
											<FolderOpen class="h-5 w-5 md:h-4 md:w-4 shrink-0" />
										{:else}
											<Folder class="h-5 w-5 md:h-4 md:w-4 shrink-0" />
										{/if}
										<span class="truncate">{list.name}</span>
										{#if list.is_default}
											<Star class="h-3.5 w-3.5 md:h-3 md:w-3 text-yellow-500 shrink-0" />
										{/if}
									</div>
									{#if taskCount > 0}
										<span class="text-sm md:text-xs text-muted-foreground shrink-0 ml-2">{taskCount}</span>
									{/if}
								</button>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onclick={() => onListEdit(list)}>
									{$t('common.rename', { default: 'Zmień nazwę' })}
								</ContextMenuItem>
								{#if !list.is_default}
									<ContextMenuItem onclick={() => onSetDefault(list)}>
										{$t('taskList.set_as_default', { default: 'Ustaw jako domyślną' })}
									</ContextMenuItem>
								{/if}
								<ContextMenuSeparator />
								<ContextMenuItem
									class="text-destructive focus:text-destructive"
									onclick={() => onListDelete(list)}
								>
									{$t('common.delete', { default: 'Usuń' })}
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
