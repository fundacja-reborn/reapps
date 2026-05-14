<!-- 
	@component
	Task detail header content - displays breadcrumb navigation and task actions
-->
<script lang="ts">
	import { Button } from '@reborn/ui';
	import * as DropdownMenu from '@reborn/ui/components/dropdown-menu';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
	import {
		Circle,
		CircleCheck,
		Star,
		MoreVertical,
		ArrowRight,
		Share2,
		Trash2,
		PenLine,
		Loader2,
		CheckCircle2
	} from '@lucide/svelte';
	import type { ListDecrypted, TaskDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { cn } from '@reborn/ui';
	import { taskDetailService } from '$lib/services/task-detail.service';

	interface Props {
		list: ListDecrypted | null;
		task: TaskDecrypted | null;
		onToggleCompleted: () => void;
		onToggleStarred: () => void;
		onOpenMoveDialog: () => void;
		onOpenShareDialog?: () => void;
		onOpenDeleteDialog: () => void;
		onNavigateToList?: () => void;
	}

	let {
		list,
		task,
		onToggleCompleted,
		onToggleStarred,
		onOpenMoveDialog,
		onOpenShareDialog,
		onOpenDeleteDialog,
		onNavigateToList
	}: Props = $props();

	// State for mobile sheet
	let mobileMenuOpen = $state(false);

	// Save status from task detail service
	const saveStatusStore = taskDetailService.saveStatus;
	let saveStatus = $derived($saveStatusStore);

	// Check if mobile
	let isMobile = $state(false);
	$effect(() => {
		if (typeof window !== 'undefined') {
			isMobile = window.innerWidth < 768;
			const handleResize = () => {
				isMobile = window.innerWidth < 768;
			};
			window.addEventListener('resize', handleResize);
			return () => window.removeEventListener('resize', handleResize);
		}
	});
</script>

{#if list || task}
	<div class="flex items-center justify-between w-full min-w-0 overflow-hidden">
		<!-- List name navigation (left aligned) -->
		<div class="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
			{#if list}
				<button
					class="flex items-center gap-1 min-w-0 text-sm font-normal text-muted-foreground hover:text-foreground transition-colors"
					onclick={onNavigateToList}
					title={list.name}
				>
					<span
						class="truncate max-w-[45vw] md:max-w-[300px]"
						style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;"
					>
						{list.name}
					</span>
				</button>
			{/if}
		</div>

		<!-- Task actions (right aligned) -->
		{#if task}
			<div class="flex items-center gap-2 flex-shrink-0">
				<!-- Save status indicator -->
				{#if saveStatus === 'dirty'}
					<PenLine class="h-4 w-4 text-amber-500" />
				{:else if saveStatus === 'saving'}
					<Loader2 class="h-4 w-4 text-muted-foreground animate-spin" />
				{:else if saveStatus === 'saved'}
					<CheckCircle2 class="h-4 w-4 text-green-600" />
				{/if}

				<!-- Complete toggle button -->
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8"
					onclick={onToggleCompleted}
					aria-label={task.is_completed
						? $t('tasks.aria.mark_as_incomplete')
						: $t('tasks.aria.mark_as_complete')}
				>
					{#if task.is_completed}
						<CircleCheck class="h-4 w-4" />
					{:else}
						<Circle class="h-4 w-4" />
					{/if}
				</Button>

				<!-- Star toggle button -->
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8"
					onclick={onToggleStarred}
					aria-label={task.is_starred ? $t('tasks.aria.remove_star') : $t('tasks.aria.add_star')}
				>
					<Star class={cn('h-4 w-4', task.is_starred && 'fill-current text-yellow-500')} />
				</Button>

				<!-- Options menu -->
				{#if isMobile}
					<!-- Mobile: Use Sheet -->
					<Button
						variant="ghost"
						size="icon"
						class="h-8 w-8"
						onclick={() => (mobileMenuOpen = true)}
						aria-label={$t('tasks.actions.more_options')}
					>
						<MoreVertical class="h-4 w-4" />
					</Button>
				{:else}
					<!-- Desktop: Use DropdownMenu with snippets -->
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="h-8 w-8"
									aria-label={$t('tasks.actions.more_options')}
								>
									<MoreVertical class="h-4 w-4" />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Item onclick={onToggleCompleted}>
								{#if task.is_completed}
									<CircleCheck class="mr-2 h-4 w-4" />
									{$t('tasks.aria.mark_as_incomplete')}
								{:else}
									<Circle class="mr-2 h-4 w-4" />
									{$t('tasks.aria.mark_as_complete')}
								{/if}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={onToggleStarred}>
								<Star class="mr-2 h-4 w-4" />
								{task.is_starred ? $t('tasks.aria.remove_star') : $t('tasks.aria.add_star')}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={onOpenMoveDialog}>
								<ArrowRight class="mr-2 h-4 w-4" />
								{$t('tasks.move_to_list')}
							</DropdownMenu.Item>
							{#if onOpenShareDialog}
								<DropdownMenu.Item onclick={onOpenShareDialog}>
									<Share2 class="mr-2 h-4 w-4" />
									{$t('share.task.menu_label')}
								</DropdownMenu.Item>
							{/if}
							<DropdownMenu.Separator />
							<DropdownMenu.Item class="text-destructive" onclick={onOpenDeleteDialog}>
								<Trash2 class="mr-2 h-4 w-4" />
								{$t('common.delete')}
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<!-- Fallback when no task is selected -->
	<div class="flex items-center justify-between w-full">
		<h1 class="text-lg font-semibold">{$t('tasks.view.select_task')}</h1>
	</div>
{/if}

<!-- Mobile menu sheet -->
{#if task}
	<Sheet bind:open={mobileMenuOpen}>
		<SheetContent side="bottom" class="h-auto">
			<SheetHeader>
				<SheetTitle>{$t('tasks.more_options')}</SheetTitle>
			</SheetHeader>
			<div class="flex flex-col gap-2 mt-4">
				<Button
					variant="ghost"
					class="justify-start"
					onclick={() => {
						mobileMenuOpen = false;
						onToggleCompleted();
					}}
				>
					{#if task.is_completed}
						<CircleCheck class="mr-2 h-4 w-4" />
						{$t('tasks.aria.mark_as_incomplete')}
					{:else}
						<Circle class="mr-2 h-4 w-4" />
						{$t('tasks.aria.mark_as_complete')}
					{/if}
				</Button>

				<Button
					variant="ghost"
					class="justify-start"
					onclick={() => {
						mobileMenuOpen = false;
						onToggleStarred();
					}}
				>
					<Star class="mr-2 h-4 w-4" />
					{task.is_starred ? $t('tasks.aria.remove_star') : $t('tasks.aria.add_star')}
				</Button>

				<Button
					variant="ghost"
					class="justify-start"
					onclick={() => {
						mobileMenuOpen = false;
						onOpenMoveDialog();
					}}
				>
					<ArrowRight class="mr-2 h-4 w-4" />
					{$t('tasks.move_to_list')}
				</Button>

				{#if onOpenShareDialog}
					<Button
						variant="ghost"
						class="justify-start"
						onclick={() => {
							mobileMenuOpen = false;
							onOpenShareDialog?.();
						}}
					>
						<Share2 class="mr-2 h-4 w-4" />
						{$t('share.task.menu_label')}
					</Button>
				{/if}

				<div class="h-px bg-border my-2"></div>

				<Button
					variant="ghost"
					class="justify-start text-destructive hover:text-destructive"
					onclick={() => {
						mobileMenuOpen = false;
						onOpenDeleteDialog();
					}}
				>
					<Trash2 class="mr-2 h-4 w-4" />
					{$t('common.delete')}
				</Button>
			</div>
		</SheetContent>
	</Sheet>
{/if}
