/**
 * Task List View Store
 *
 * Mirrors the Notes search architecture (apps/reborn-notes/src/lib/stores/notes.store.ts):
 *   - Single source of truth (`_raw`) for the sidebar's currently visible task list.
 *   - One `refresh()` brain that parses the search query and routes between
 *     title-only (sync) and body-aware (async) paths.
 *   - One rendering path in the consumer (`<SidebarTaskList>`) — no flag-based
 *     switching between "normal list" and "search results" views.
 *
 * Scope is one of the SidebarTaskList sections: 'all', 'starred', 'overdue',
 * 'today', 'upcoming', 'no_date', or 'trash'. Per-list views (`/lists/:id`) use
 * `TaskList.svelte` which goes through `decrypted-tasks.store` directly — that
 * surface is not affected by this store.
 *
 * Replaces the deprecated `search-results.store.ts` + `SearchResults.svelte`
 * pair. Generation counters guard against stale async writes the same way
 * `notesStore` does (`refreshVersion` for sync, `contentSearchVersion` for the
 * body-aware fork).
 */

import { writable, derived, get, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { taskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import {
	buildLiteAst,
	createLogger,
	evaluate,
	isEmpty as isAstEmpty,
	parseQuery,
	requiresContent,
	type QueryAST,
	type SearchEntity
} from '@reborn/utils';
import type { TaskEncryptedBooleans } from '@reborn/types';
import {
	taskIndex,
	type TaskListItem,
	type TaskFilterOptions,
	type TaskFilterByAstOptions
} from '$lib/services/task-title-index.svelte';
import { buildTaskSearchContext } from '$lib/services/task-search-context';
import { decryptedTrashTasks } from '$lib/stores/decrypted-trash.store';
import { taskSortStore, type TaskSortOption } from '$lib/stores/task-sort.store';
import type { TaskSortField } from '$lib/services/task-title-index.svelte';

const logger = createLogger('TaskListViewStore');

/** Sidebar section identifiers — same set SidebarTaskList renders for. */
export type ListViewSection =
	| 'all'
	| 'starred'
	| 'overdue'
	| 'today'
	| 'upcoming'
	| 'no_date'
	| 'trash';

function mapSortOption(option: TaskSortOption): TaskSortField {
	switch (option) {
		case 'alphabetical':
			return 'alphabetical';
		case 'due_date':
			return 'due_date';
		case 'created_date':
			return 'created_date';
		case 'starred':
			return 'starred';
		default:
			return 'position';
	}
}

function createTaskListViewStore() {
	const _raw = writable<TaskListItem[]>([]);
	const loading = writable(false);
	const searchQuery = writable('');
	const searchInDescription = writable(false);

	let currentSection: ListViewSection = 'all';

	// Stale-write guards: each refresh increments its own counter, late writers
	// bail out on version mismatch. Sync and async paths use separate counters
	// because they can interleave (a body-aware run is in flight when the user
	// flips the toggle off and a sync run starts).
	let refreshVersion = 0;
	let contentSearchVersion = 0;

	/** Build the pre-filter slice for `taskIndex.getFiltered*` based on the active section. */
	function buildFilterOptions(): TaskFilterOptions & TaskFilterByAstOptions {
		const { option, direction } = get(taskSortStore)[currentSection] ?? {
			option: 'due_date',
			direction: 'asc' as const
		};
		const sortBy = mapSortOption(option);
		const sortDirection = direction;

		switch (currentSection) {
			case 'trash':
				return { deleted: true, excludeTemplates: false, sortBy, sortDirection };
			case 'starred':
				return { starred: true, sortBy, sortDirection };
			case 'today':
				return { section: 'today', sortBy, sortDirection };
			case 'overdue':
				return { section: 'overdue', sortBy, sortDirection };
			case 'upcoming':
				return { section: 'upcoming', sortBy, sortDirection };
			case 'no_date':
				return { section: 'no_date', sortBy, sortDirection };
			default:
				return { sortBy, sortDirection };
		}
	}

	/** Apply trash-specific deletion-date sort that matches `decryptedTrashTasks`. */
	function applyTrashSort(items: TaskListItem[]): TaskListItem[] {
		return [...items].sort((a, b) => {
			if (!a.deleted_at && !b.deleted_at) return 0;
			if (!a.deleted_at) return 1;
			if (!b.deleted_at) return -1;
			return new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime();
		});
	}

	/**
	 * Refresh the visible list from the in-memory TaskIndex.
	 *
	 * Empty AST → fast `getFiltered` path. Single-word freetext with no operators
	 * and no excludes → `getFiltered({ search })`. Anything else → AST evaluation
	 * via `getFilteredByAst`. Operators that need decrypted body (`has:link`) or
	 * the user-enabled "search in descriptions" toggle delegate fully to
	 * `triggerContentSearch()`; the title-only intermediate is skipped to avoid
	 * flashing wrong results, and the previous `_raw` stays visible until the
	 * body-aware pass completes.
	 */
	function refresh(): void {
		if (!browser) return;
		const myVersion = ++refreshVersion;

		try {
			const ast = parseQuery(get(searchQuery));
			const filterOpts = buildFilterOptions();
			const wantsContent =
				requiresContent(ast) || (get(searchInDescription) && !isAstEmpty(ast));

			if (wantsContent) {
				// Body-aware path takes over fully.
				triggerContentSearch(ast, filterOpts);
				return;
			}

			// Cancel any in-flight content search — its result would now be stale.
			contentSearchVersion++;

			const items = evaluateAgainstIndex(ast, filterOpts);
			if (myVersion !== refreshVersion) return;
			_raw.set(currentSection === 'trash' ? applyTrashSort(items) : items);
		} catch (err) {
			// TaskIndex might not be built yet (pre-unlock) or query parse failed.
			logger.warn('refresh failed', { err });
			if (myVersion !== refreshVersion) return;
			_raw.set([]);
		}
	}

	/**
	 * Synchronous AST evaluation against the in-memory TaskIndex.
	 *
	 * Three routing cases (mirrors Notes):
	 *   1. Empty AST → return the visible scope as-is via `getFiltered`.
	 *   2. Single positive leaf-text → fast title-substring path through
	 *      `getFiltered({ search })`. Bypasses building a SearchContext.
	 *   3. Anything else → full AST evaluation via `getFilteredByAst`.
	 */
	function evaluateAgainstIndex(
		ast: QueryAST,
		filterOpts: TaskFilterOptions & TaskFilterByAstOptions
	): TaskListItem[] {
		if (isAstEmpty(ast)) {
			return taskIndex.getFiltered(filterOpts).items;
		}
		if (ast.root !== null && ast.root.kind === 'leaf-text' && !ast.root.negated) {
			return taskIndex.getFiltered({ ...filterOpts, search: ast.root.value }).items;
		}
		const ctx = buildTaskSearchContext();
		return taskIndex.getFilteredByAst(ast, ctx, filterOpts).items;
	}

	/**
	 * Body-aware search. Streams through pre-filtered candidates one description
	 * at a time, evaluates the full AST per-task, and overwrites `_raw` with
	 * matches.
	 *
	 * Memory: peak RAM ≈ 1 decrypted task description (each iteration releases
	 * its decrypted entity before the next `await` resolves). Matched results
	 * are stored as `TaskListItem` (metadata only, no description).
	 *
	 * Pre-filter strategy:
	 *   - Drop freetext from `liteAst` — re-checked against title+body post-decryption.
	 *     Keeping it would exclude tasks whose freetext lives only in description.
	 *   - Drop `has:*` filters — they need decrypted body, can't pre-check.
	 *   - Keep structural operators (list/dates/is:*) so they narrow the candidate set.
	 *
	 * Cancellation: `contentSearchVersion` ticks on every refresh; stale generations
	 * exit immediately on the next iteration boundary.
	 */
	async function triggerContentSearch(
		ast: QueryAST,
		filterOpts: TaskFilterOptions & TaskFilterByAstOptions
	): Promise<void> {
		if (isAstEmpty(ast)) return;
		const myVersion = ++contentSearchVersion;
		loading.set(true);
		try {
			// 1. Pre-filter: lite-AST drops body-dependent leaves (leaf-text,
			//    has:*) and is polarity-aware so NOT-of-leaf-text doesn't
			//    collapse the candidate set.
			const liteAst = buildLiteAst(ast);
			const ctx = buildTaskSearchContext();
			const candidates = isAstEmpty(liteAst)
				? taskIndex.getFiltered(filterOpts).items
				: taskIndex.getFilteredByAst(liteAst, ctx, filterOpts).items;

			// Quick lookup of encrypted records for streaming decryption.
			const encryptedById = new Map<string, TaskEncryptedBooleans>();
			for (const enc of get(taskStore.items)) {
				encryptedById.set(enc.id, enc);
			}

			// 2. Stream-decrypt: peak ≈ 1 description.
			const matchedItems: TaskListItem[] = [];
			const YIELD_EVERY = 50;
			for (let i = 0; i < candidates.length; i++) {
				if (myVersion !== contentSearchVersion) return;
				const item = candidates[i];
				const enc = encryptedById.get(item.id);
				if (!enc) continue;

				let description = '';
				try {
					if (enc.description_encrypted) {
						description = await cryptoManager.decryptText(enc.description_encrypted);
					}
				} catch {
					description = '';
				}

				if (myVersion !== contentSearchVersion) return;

				const entity = listItemToSearchEntity(item, description);
				if (evaluate(ast, entity, ctx)) {
					matchedItems.push(item);
				}

				if ((i + 1) % YIELD_EVERY === 0) {
					await new Promise((r) => setTimeout(r, 0));
				}
			}

			if (myVersion !== contentSearchVersion) return;
			_raw.set(currentSection === 'trash' ? applyTrashSort(matchedItems) : matchedItems);
		} finally {
			if (myVersion === contentSearchVersion) loading.set(false);
		}
	}

	function setSection(section: ListViewSection): void {
		if (section === currentSection) return;
		currentSection = section;
		refresh();
	}

	function setSearch(query: string): void {
		searchQuery.set(query);
		refresh();
	}

	function setSearchInDescription(enabled: boolean): void {
		searchInDescription.set(enabled);
		refresh();
	}

	function clear(): void {
		// Cancel any in-flight body-aware run.
		contentSearchVersion++;
		searchQuery.set('');
		searchInDescription.set(false);
		refresh();
	}

	// Reactive bridges: re-run refresh when the underlying TaskIndex changes
	// (sync, build, in-place patches), or when the user changes their sort
	// preference for the active section.
	taskIndex.onChange(() => refresh());
	taskSortStore.subscribe(() => {
		// Sort changes don't affect the sync vs body-aware routing — just re-run.
		refresh();
	});

	// Trash store ordering uses a custom `deleted_at desc` sort; we replicate
	// it in `applyTrashSort` rather than re-deriving from `decryptedTrashTasks`,
	// but keep an explicit subscribe to ensure trash-only updates don't get lost
	// if `taskIndex` ever batches its onChange notifications differently.
	decryptedTrashTasks.subscribe(() => {
		if (currentSection === 'trash') refresh();
	});

	const visible: Readable<TaskListItem[]> = derived(_raw, ($raw) => $raw);

	return {
		subscribe: visible.subscribe,
		loading: { subscribe: loading.subscribe } as Readable<boolean>,
		searchQuery: { subscribe: searchQuery.subscribe } as Readable<string>,
		searchInDescription: { subscribe: searchInDescription.subscribe } as Readable<boolean>,
		setSection,
		setSearch,
		setSearchInDescription,
		clear,
		refresh
	};
}

function listItemToSearchEntity(task: TaskListItem, description: string): SearchEntity {
	return {
		id: task.id,
		title: task.title,
		body: description,
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

export const taskListView = createTaskListViewStore();
