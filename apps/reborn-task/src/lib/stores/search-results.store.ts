/**
 * Search Results Store
 *
 * Reactive store for the global task search box. Wires the @reborn/utils
 * search-query AST into the existing taskTitleIndex + searchService pair.
 *
 * Routing rules (`search(query)`):
 *   - Empty query                                 → clear results.
 *   - Single freetext word/phrase, no operators,
 *     no exclude, no body needed                  → instant title-substring path
 *                                                   via `taskTitleIndex.search`.
 *   - Multi-word/phrase/exclude/operator AND no
 *     body needed                                 → AST-on-index path via
 *                                                   `taskTitleIndex.getFilteredByAst`.
 *   - `requiresContent(ast)` OR (`searchInDescription` toggle on AND
 *      non-empty freetext)                        → body-aware path via
 *                                                   `searchService.searchTasksInBatches`
 *                                                   with the AST evaluator as predicate.
 *
 * Body-aware path uses a streaming async generator so results render as soon
 * as they are decrypted (UX win for large vaults).
 */

import { writable, derived, get } from 'svelte/store';
import { searchService } from '$lib/services/search.service';
import { taskTitleIndex } from '$lib/services/task-title-index.svelte';
import type { TaskListItem } from '$lib/services/task-title-index.svelte';
import { buildTaskSearchContext } from '$lib/services/task-search-context';
import {
	createLogger,
	evaluate,
	freetextIsEmpty,
	parseQuery,
	requiresContent,
	type SearchEntity
} from '@reborn/utils';
import type { TaskDecrypted } from '@reborn/types';

const logger = createLogger('SearchResultsStore');

const MAX_RESULTS = 20;

interface SearchState {
	query: string;
	isSearching: boolean;
	results: TaskListItem[];
	hasMore: boolean;
	error: string | null;
	searchInDescription: boolean;
}

function createSearchStore() {
	const { subscribe, update } = writable<SearchState>({
		query: '',
		isSearching: false,
		results: [],
		hasMore: false,
		error: null,
		searchInDescription: false
	});

	/**
	 * Update search query without performing search.
	 */
	function updateQuery(query: string) {
		update((state) => ({ ...state, query }));
	}

	/**
	 * Perform search immediately (no debouncing).
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

		const ast = parseQuery(query);
		const ctx = buildTaskSearchContext();
		const currentState = get({ subscribe });
		const wantsContent =
			requiresContent(ast) || (currentState.searchInDescription && !freetextIsEmpty(ast.freetext));

		// Title-only path — no decryption required
		if (!wantsContent) {
			const isSingleWordOnly =
				ast.filters.length === 0 &&
				ast.freetext.exclude.length === 0 &&
				ast.freetext.include.length === 1;
			const titleMatches = isSingleWordOnly
				? taskTitleIndex.search(ast.freetext.include[0])
				: taskTitleIndex.getFilteredByAst(ast, ctx, { excludeTemplates: true }).items;

			const results: TaskListItem[] = titleMatches.slice(0, MAX_RESULTS);

			update((state) => ({
				...state,
				isSearching: false,
				results,
				hasMore: titleMatches.length > MAX_RESULTS,
				error: null
			}));

			logger.info('Title-only search completed', { query, resultsCount: results.length });
			return;
		}

		// Body-aware path: stream results from searchService with AST predicate
		logger.info('Starting full search', { query });

		update((state) => ({
			...state,
			isSearching: true,
			results: [],
			hasMore: false,
			error: null
		}));

		try {
			const results: TaskListItem[] = [];
			const predicate = (task: TaskDecrypted) =>
				evaluate(ast, mapTaskToSearchEntity(task), ctx);

			// Pass an empty query — the predicate (full AST evaluator) is
			// authoritative for both freetext and operators. searchTasksInBatches
			// recognizes the predicate-only mode and scans every active task.
			for await (const task of searchService.searchTasksInBatches('', {
				maxResults: MAX_RESULTS + 1, // Fetch one extra to detect hasMore
				batchSize: 10,
				searchInDescription: true,
				predicate
			})) {
				if (results.length < MAX_RESULTS) {
					results.push(taskDecryptedToListItem(task));

					// Reactive incremental update so the UI streams results
					update((state) => ({
						...state,
						results: [...results],
						isSearching: true
					}));
				}
			}

			const hasMore = results.length > MAX_RESULTS;
			if (hasMore) results.pop();

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
	 * Clear search and results.
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
	 * Cancel ongoing search.
	 */
	function cancel() {
		searchService.cancelCurrentSearch();
		update((state) => ({
			...state,
			isSearching: false
		}));
	}

	/**
	 * Toggle search-in-descriptions mode and re-run the search.
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

/**
 * Map a fully-decrypted TaskDecrypted (from searchService) to the SearchEntity
 * shape expected by the AST evaluator. Mirrors `toSearchEntity` in
 * task-title-index but works off TaskDecrypted instead of TaskIndexEntry so
 * `entity.body` carries the decrypted description for `has:link` and
 * description-aware freetext matching.
 */
function mapTaskToSearchEntity(task: TaskDecrypted): SearchEntity {
	return {
		id: task.id,
		title: task.title,
		body: task.description,
		tagIds: [],
		folderId: null,
		listId: task.task_list_id ?? null,
		createdAt: new Date(task.created_at),
		updatedAt: new Date(task.updated_at),
		dueAt: task.due_date ? new Date(task.due_date) : null,
		flags: {
			starred: task.is_starred,
			completed: task.is_completed,
			trashed: !!task.deleted_at
		}
	};
}

/** Project a TaskDecrypted into the TaskListItem shape consumed by SearchResults UI. */
function taskDecryptedToListItem(task: TaskDecrypted): TaskListItem {
	return {
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
