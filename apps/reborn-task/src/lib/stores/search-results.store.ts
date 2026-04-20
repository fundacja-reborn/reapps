/**
 * Search Results Store
 *
 * This store manages search results and search state for the UI.
 * It uses the SearchService to perform secure in-memory searches
 * and provides reactive updates as results are found.
 */

import { writable, derived, get } from 'svelte/store';
import { searchService } from '$lib/services/search.service';
import { taskTitleIndex } from '$lib/services/task-title-index.svelte';
import type { TaskListItem } from '$lib/services/task-title-index.svelte';
import { createLogger } from '@reborn/utils';

const logger = createLogger('SearchResultsStore');

// Search state
interface SearchState {
	query: string;
	isSearching: boolean;
	results: TaskListItem[];
	hasMore: boolean;
	error: string | null;
	searchInDescription: boolean;
}

// Create writable store for search state
function createSearchStore() {
	const { subscribe, update } = writable<SearchState>({
		query: '',
		isSearching: false,
		results: [],
		hasMore: false,
		error: null,
		searchInDescription: false
	});

	// Search state

	/**
	 * Update search query without performing search
	 */
	function updateQuery(query: string) {
		update((state) => ({ ...state, query }));
	}

	/**
	 * Perform search immediately (no debouncing)
	 */
	async function search(query: string) {
		// Cancel any ongoing search
		searchService.cancelCurrentSearch();

		// Update query immediately for UI feedback
		update((state) => ({ ...state, query }));

		// If empty query, clear results immediately
		if (!query.trim()) {
			update((state) => ({
				...state,
				query: '',
				isSearching: false,
				results: [],
				hasMore: false,
				error: null
			}));
			return;
		}

		const currentState = get({ subscribe });

		// Title-only mode: instant search via taskTitleIndex
		if (!currentState.searchInDescription) {
			const titleMatches = taskTitleIndex.search(query);
			const results: TaskListItem[] = titleMatches.slice(0, 20);

			update((state) => ({
				...state,
				isSearching: false,
				results,
				hasMore: titleMatches.length > 20,
				error: null
			}));

			logger.info('Title-only search completed', { query, resultsCount: results.length });
			return;
		}

		// Full search mode: decrypt and search descriptions
		logger.info('Starting full search', { query });

		// Set searching state
		update((state) => ({
			...state,
			isSearching: true,
			results: [], // Clear previous results
			hasMore: false,
			error: null
		}));

		try {
			const results: TaskListItem[] = [];
			const maxResults = 20; // As per requirements

			// Use async generator to get results in batches
			for await (const task of searchService.searchTasksInBatches(query, {
				maxResults: maxResults + 1, // Fetch one extra to check if there are more
				batchSize: 10,
				searchInDescription: true
			})) {
				if (results.length < maxResults) {
					results.push({
						id: task.id,
						task_list_id: task.task_list_id,
						title: task.title,
						due_date: task.due_date ?? null,
						has_time: task.has_time ?? false,
						is_completed: task.is_completed,
						is_starred: task.is_starred,
						is_recurring: task.is_recurring ?? false,
						is_template: task.is_template,
						completed_at: task.completed_at ?? null,
						completed_occurrences_count: task.completed_occurrences_count ?? 0,
						position: task.position,
						parent_task_id: task.parent_task_id ?? null,
						created_at: task.created_at,
						updated_at: task.updated_at,
						deleted_at: task.deleted_at ?? null
					});

					// Update results reactively as they come in
					update((state) => ({
						...state,
						results: [...results],
						isSearching: true // Still searching
					}));
				}
			}

			// Check if there are more results
			const hasMore = results.length > maxResults;
			if (hasMore) {
				results.pop(); // Remove the extra result
			}

			// Final update
			update((state) => ({
				...state,
				isSearching: false,
				results,
				hasMore,
				error: null
			}));

			logger.info('Full search completed', {
				query,
				resultsCount: results.length,
				hasMore
			});
		} catch (error: unknown) {
			logger.error('Search failed', { query, error });

			update((state) => ({
				...state,
				isSearching: false,
				error: error instanceof Error ? error.message : 'Search failed'
			}));
		}
	}

	/**
	 * Clear search and results
	 */
	function clear() {
		searchService.cancelCurrentSearch();
		update((state) => ({
			...state,
			query: '',
			isSearching: false,
			results: [],
			hasMore: false,
			error: null,
			searchInDescription: false
		}));
	}

	/**
	 * Cancel ongoing search
	 */
	function cancel() {
		searchService.cancelCurrentSearch();
		update((state) => ({
			...state,
			isSearching: false
		}));
	}

	/**
	 * Toggle search in descriptions mode and re-search
	 */
	function setSearchInDescription(enabled: boolean) {
		update((state) => ({ ...state, searchInDescription: enabled }));
		const currentState = get({ subscribe });
		if (currentState.query.trim()) {
			search(currentState.query);
		}
	}

	return {
		subscribe,
		updateQuery,
		search,
		clear,
		cancel,
		setSearchInDescription
	};
}

// Create the search store instance
export const searchStore = createSearchStore();

// Derived stores for convenient access
export const searchQuery = derived(searchStore, ($store) => $store.query);
export const searchResults = derived(searchStore, ($store) => $store.results);
export const isSearching = derived(searchStore, ($store) => $store.isSearching);
export const hasMoreResults = derived(searchStore, ($store) => $store.hasMore);
export const searchError = derived(searchStore, ($store) => $store.error);
export const searchInDescription = derived(searchStore, ($store) => $store.searchInDescription);

// Helper to check if search is active - only when we have results to show
export const isSearchActive = derived(
	searchStore,
	($store) => $store.results.length > 0 || $store.isSearching
);

// Export convenience functions
export const {
	search,
	clear: clearSearch,
	cancel: cancelSearch,
	setSearchInDescription
} = searchStore;
