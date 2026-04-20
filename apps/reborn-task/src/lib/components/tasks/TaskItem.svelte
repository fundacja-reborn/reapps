<script lang="ts">
	import { Checkbox, cn } from '@reborn/ui';
	import { Star, Calendar, RotateCw, Clock, AlertCircle, Folder } from '@lucide/svelte';
	import type { TaskListItem } from '$lib/services/task-title-index.svelte';
	import { createLogger } from '@reborn/utils';
	import { t, locale } from '$lib/stores/i18n.store';
	import { dateFormat } from '$lib/stores/app-settings.store';
	import { formatDueDate, truncateListName } from '$lib/services/task-formatting.service';

	const logger = createLogger('TaskItem');

	let {
		task,
		listName = null,
		showListName = false,
		onClick,
		onComplete,
		onToggleStar,
		class: className = ''
	} = $props<{
		task: TaskListItem;
		listName?: string | null;
		showListName?: boolean;
		onClick?: () => void;
		onComplete?: (completed: boolean) => void | Promise<void>;
		onToggleStar?: () => void | Promise<void>;
		class?: string;
	}>();

	let isUpdating = $state(false);

	async function handleComplete(e: MouseEvent) {
		e.stopPropagation();
		if (isUpdating) return;

		isUpdating = true;
		try {
			await onComplete?.(!task.is_completed);
		} catch (error: unknown) {
			logger.error('Failed to update task completion:', error);
		} finally {
			isUpdating = false;
		}
	}

	async function handleToggleStar(e: MouseEvent) {
		e.stopPropagation();
		if (isUpdating) return;

		isUpdating = true;
		try {
			await onToggleStar?.();
		} catch (error: unknown) {
			logger.error('Failed to toggle star:', error);
		} finally {
			isUpdating = false;
		}
	}

	const dueDate = $derived(
		formatDueDate(task.due_date, task.has_time, $locale || 'en', $t, $dateFormat)
	);

	const hasMetadata = $derived(
		(!!dueDate && !task.is_completed) ||
			(showListName && !!listName) ||
			task.is_recurring ||
			!!task.parent_task_id ||
			(task.is_completed && !!task.completed_at)
	);
</script>

<div
	class={cn(
		'group flex items-center gap-3 p-3.5 rounded-lg cursor-pointer relative',
		'task-item-bg transition-opacity duration-300 outline-none',
		task.is_completed && 'opacity-60',
		className
	)}
	data-task-item="true"
	onclick={onClick}
	role="button"
	tabindex="0"
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onClick?.();
		}
	}}
>
	<!-- Checkbox -->
	{#if onComplete}
		<div
			class="flex items-center justify-center min-h-11 min-w-11 -m-1.5 p-1.5 cursor-pointer"
			onclick={handleComplete}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
				}
			}}
			role="presentation"
		>
			<Checkbox
				checked={task.is_completed}
				disabled={isUpdating}
				aria-label={task.is_completed
					? $t('tasks.aria.mark_as_incomplete')
					: $t('tasks.aria.mark_as_complete')}
				class="rounded-full"
			/>
		</div>
	{/if}

	<!-- Content -->
	<div class="flex-1 min-w-0">
		<h3
			class={cn('font-normal text-base md:text-sm', task.is_completed && 'line-through text-muted-foreground')}
		>
			{task.title}
		</h3>

		<!-- Metadata -->
		{#if hasMetadata}
			<div class="flex items-center gap-2 mt-2 text-sm flex-wrap">
				{#if dueDate && !task.is_completed}
					<div class="flex items-center gap-1">
						{#if dueDate.status === 'overdue'}
							<AlertCircle class="h-4 w-4 task-date-overdue" />
							<span class="task-date-overdue font-medium">
								{dueDate.relativeText || dueDate.text}
								{#if dueDate.text && dueDate.relativeText}, {dueDate.text}{/if}
							</span>
						{:else if dueDate.status === 'today'}
							{#if dueDate.isTimeOverdue}
								<AlertCircle class="h-4 w-4 task-date-overdue" />
								<span class="task-date-overdue font-medium">
									{dueDate.relativeText}{#if dueDate.text}, {dueDate.text}{/if}
								</span>
							{:else}
								<Clock class="h-4 w-4" />
								<div
									class="task-badge-today inline-flex items-center rounded-full px-2 py-0.5 h-6 text-sm font-medium"
								>
									{dueDate.relativeText}{#if dueDate.text}, {dueDate.text}{/if}
								</div>
							{/if}
						{:else if dueDate.status === 'tomorrow'}
							<Clock class="h-4 w-4" />
							<div
								class="task-badge-tomorrow inline-flex items-center rounded-full px-2 py-0.5 h-6 text-sm"
							>
								{dueDate.relativeText}{#if dueDate.text}, {dueDate.text}{/if}
							</div>
						{:else if dueDate.status === 'upcoming'}
							<Calendar class="h-4 w-4 text-muted-foreground" />
							<span class="text-muted-foreground">
								{dueDate.relativeText}{#if dueDate.text}, {dueDate.text}{/if}
							</span>
						{:else}
							<Calendar class="h-4 w-4 text-muted-foreground" />
							<span class="text-muted-foreground">{dueDate.text}</span>
						{/if}
					</div>
				{/if}

				{#if showListName && listName}
					<div class="flex items-center gap-1" title={listName}>
						<Folder class="h-4 w-4 text-muted-foreground" />
						<span class="text-muted-foreground">{truncateListName(listName)}</span>
					</div>
				{/if}

				{#if task.is_recurring || task.parent_task_id}
					<div class="flex items-center gap-1 text-muted-foreground">
						<RotateCw class="h-4 w-4" />
						{#if task.completed_occurrences_count > 0}
							<span
								>{$t('tasks.recurring.completed_count', {
									values: { count: task.completed_occurrences_count }
								})}</span
							>
						{/if}
					</div>
				{/if}

				{#if task.is_completed && task.completed_at}
					{@const completedDate = formatDueDate(
						task.completed_at,
						true,
						$locale || 'en',
						$t,
						$dateFormat
					)}
					{#if completedDate}
						<div class="flex items-center gap-1 text-muted-foreground">
							<Calendar class="h-4 w-4" />
							<span>
								{completedDate.relativeText}{#if completedDate.text}, {completedDate.text}{/if}
							</span>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<!-- Star button -->
	{#if onToggleStar}
		<button
			onclick={handleToggleStar}
			disabled={isUpdating}
			class={cn(
				'flex items-center justify-center h-5',
				'focus:outline-none rounded',
				'disabled:opacity-50 disabled:cursor-not-allowed'
			)}
			aria-label={task.is_starred ? $t('tasks.aria.remove_star') : $t('tasks.aria.add_star')}
		>
			<Star
				class={cn(
					'h-4 w-4',
					task.is_starred ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'
				)}
			/>
		</button>
	{/if}
</div>
