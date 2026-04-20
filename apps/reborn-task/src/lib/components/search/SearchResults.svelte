<script lang="ts">
	import { TaskItem } from '$lib/components/tasks';
	import {
		searchResults,
		isSearching,
		hasMoreResults,
		searchError,
		searchQuery
	} from '$lib/stores/search-results.store';
	import { taskOperationsService } from '$lib/services/task-operations.service';
	import { notificationService } from '$lib/services/notification.service';
	import { t } from '$lib/stores/i18n.store';
	import { Search, Loader2 } from '@lucide/svelte';
	import { activeLists } from '$lib/stores/decrypted-lists.store';
	import { useSidebar } from '@reborn/ui/sidebar';

	// Props
	let { onTaskClick = async (taskId: string) => {} } = $props();

	// Handle task complete
	async function handleTaskComplete(taskId: string, completed: boolean) {
		try {
			await taskOperationsService.toggleCompleted(taskId);
		} catch (error: unknown) {
			notificationService.error(error instanceof Error ? error.message : 'Failed to toggle task');
		}
	}

	// Handle task star toggle
	async function handleToggleStar(taskId: string) {
		try {
			await taskOperationsService.toggleStarred(taskId);
		} catch (error: unknown) {
			notificationService.error(error instanceof Error ? error.message : 'Failed to toggle star');
		}
	}

	// Get display info
	const query = $derived($searchQuery);
	const results = $derived($searchResults);
	const loading = $derived($isSearching);
	const hasMore = $derived($hasMoreResults);
	const error = $derived($searchError);

	// Get sidebar context for mobile detection
	const sidebar = useSidebar();

	// Create a map of list names for quick lookup
	const listNamesMap = $derived(
		$activeLists.reduce(
			(acc, list) => {
				acc[list.id] = list.name;
				return acc;
			},
			{} as Record<string, string>
		)
	);

	// Highlight matched text
	function highlightMatch(text: string, query: string): string {
		if (!query) return text;

		const regex = new RegExp(`(${query})`, 'gi');
		return text.replace(
			regex,
			'<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">$1</mark>'
		);
	}
</script>

<div class="flex flex-col h-full">
	<!-- Mobile: Show title at the top of the page -->
	{#if sidebar.isMobile && query}
		<div class="py-4">
			<h1 class="text-lg font-semibold">
				{$t('search.results_title', { values: { query } })}
			</h1>
		</div>
	{/if}

	<!-- Results content -->
	<div class="flex-1 overflow-y-auto">
		{#if error}
			<!-- Error state -->
			<div class="p-4 text-center text-destructive">
				<p>{error}</p>
			</div>
		{:else if loading && results.length === 0}
			<!-- Initial loading state -->
			<div class="flex flex-col items-center justify-center p-8 gap-4">
				<Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
				<p class="text-muted-foreground">{$t('search.searching')}</p>
			</div>
		{:else if results.length === 0 && !loading}
			<!-- No results -->
			<div class="flex flex-col items-center justify-center p-8 gap-4">
				<Search class="h-12 w-12 text-muted-foreground/50" />
				<div class="text-center">
					<p class="text-lg font-medium">{$t('search.no_results', { values: { query } })}</p>
					<p class="text-sm text-muted-foreground mt-1">
						{$t('search.no_results_hint')}
					</p>
				</div>
			</div>
		{:else}
			<!-- Results list -->
			<div class="space-y-2">
				{#each results as task (task.id)}
					<div>
						<TaskItem
							{task}
							listName={listNamesMap[task.task_list_id]}
							onComplete={(completed) => handleTaskComplete(task.id, completed)}
							onToggleStar={() => handleToggleStar(task.id)}
							onClick={() => onTaskClick(task.id)}
							showListName={true}
						/>
					</div>
				{/each}

				<!-- Show more indicator -->
				{#if hasMore}
					<div class="p-4 text-center text-sm text-muted-foreground">
						{$t('search.more_results_available')}
					</div>
				{/if}

				<!-- Loading more indicator -->
				{#if loading && results.length > 0}
					<div class="p-4 flex items-center justify-center gap-2">
						<Loader2 class="h-4 w-4 animate-spin" />
						<span class="text-sm text-muted-foreground">{$t('search.loading_more')}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Results summary -->
	{#if results.length > 0}
		<div class="p-3 border-t text-sm text-muted-foreground text-center">
			{$t('search.results_count', { values: { count: results.length } })}
			{#if hasMore}
				 {$t('search.showing_first_n', { values: { n: 20 } })}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Ensure highlight marks are visible */
	:global(mark) {
		background-color: rgb(254 240 138 / var(--tw-bg-opacity));
		padding: 0 0.125rem;
		border-radius: 0.125rem;
	}

	:global(.dark mark) {
		background-color: rgb(133 77 14 / var(--tw-bg-opacity));
	}
</style>
