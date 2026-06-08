/**
 * TaskIndex — in-memory cache of decrypted task metadata for list views.
 *
 * Security: RAM-only, NEVER persisted. Cleared on logout.
 * Rebuilt after sync. ~3 MB for 10K tasks (vs ~50 MB full decrypt with description).
 *
 * Only `title_encrypted` is decrypted here — all other fields are unencrypted metadata
 * copied directly from IndexedDB. Description and recurrence_rule are loaded on-demand
 * by task-detail.service.ts when a task is opened.
 *
 * Consumers: decrypted-tasks.store, decrypted-trash.store, SidebarTaskList, SearchService.
 */
import { taskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import type { TaskEncryptedBooleans, TaskSensitiveMetadata } from '@reborn/types';
import { evaluate, type QueryAST, type SearchContext, type SearchEntity } from '@reborn/utils';

export interface TaskIndexEntry {
	title: string;
	listId: string | undefined;
	createdAt: string;
	updatedAt: string;
	isCompleted: boolean;
	isStarred: boolean;
	isDeleted: boolean;
	deletedAt: string | null;
	dueDate: string | null;
	hasTime: boolean;
	isRecurring: boolean;
	isTemplate: boolean;
	completedAt: string | null;
	completedOccurrencesCount: number;
	position: number;
	parentTaskId: string | null;
}

/** Lightweight task type for list views — all fields needed by TaskItem. */
export interface TaskListItem {
	id: string;
	task_list_id: string;
	title: string;
	due_date: string | null;
	has_time: boolean;
	is_completed: boolean;
	is_starred: boolean;
	is_recurring: boolean;
	is_template: boolean;
	completed_at: string | null;
	completed_occurrences_count: number;
	position: number;
	parent_task_id: string | null;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export type TaskSortField = 'due_date' | 'alphabetical' | 'created_date' | 'starred' | 'position';

export interface TaskFilterOptions {
	listId?: string;
	section?: 'all' | 'today' | 'overdue' | 'upcoming' | 'no_date';
	completed?: boolean;
	starred?: boolean;
	deleted?: boolean;
	search?: string;
	sortBy?: TaskSortField;
	sortDirection?: 'asc' | 'desc';
	excludeTemplates?: boolean;
}

export interface TaskFilterResult {
	items: TaskListItem[];
	total: number;
}

/**
 * AST-driven filter options. Reuses the pre-filter slice of TaskFilterOptions
 * (listId/section/completed/starred/deleted/excludeTemplates) and adds an
 * optional `bodyById` map populated by the content-search path so operators
 * like `has:link` can match.
 */
export interface TaskFilterByAstOptions {
	listId?: string;
	section?: 'all' | 'today' | 'overdue' | 'upcoming' | 'no_date';
	completed?: boolean;
	starred?: boolean;
	deleted?: boolean;
	sortBy?: TaskSortField;
	sortDirection?: 'asc' | 'desc';
	excludeTemplates?: boolean;
	bodyById?: Map<string, string>;
}

const BATCH_SIZE = 100;

async function decryptTaskEntry(
	enc: TaskEncryptedBooleans
): Promise<({ id: string } & TaskIndexEntry) | null> {
	let title: string;
	try {
		title = await cryptoManager.decryptText(enc.title_encrypted);
	} catch {
		// Decryption failed — likely stale data from another user's session.
		// Return null so build() can filter this entry out instead of showing
		// a blank task card in the UI.
		return null;
	}

	// Decrypt metadata bundle for fields not available as shadow indexes
	let meta: TaskSensitiveMetadata | null = null;
	try {
		if (enc.metadata_encrypted) {
			meta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(enc.metadata_encrypted);
		}
	} catch {
		meta = null;
	}

	return {
		id: enc.id,
		title,
		listId: enc.task_list_id,
		createdAt: enc.created_at,
		updatedAt: enc.updated_at,
		// Shadow indexes (available directly on TaskEncryptedBooleans)
		isCompleted: enc.is_completed ?? false,
		isStarred: enc.is_starred ?? false,
		isDeleted: !!enc.deleted_at,
		deletedAt: enc.deleted_at ?? null,
		dueDate: enc.due_date ?? null,
		isRecurring: enc.is_recurring ?? false,
		isTemplate: enc.is_template ?? false,
		// From decrypted metadata
		hasTime: meta?.has_time ?? false,
		completedAt: meta?.completed_at ?? null,
		completedOccurrencesCount: meta?.completed_occurrences_count ?? 0,
		position: enc.position,
		parentTaskId: enc.parent_task_id ?? null
	};
}

/** Convert an index entry to a TaskListItem for UI consumption. */
function toListItem(id: string, e: TaskIndexEntry): TaskListItem {
	return {
		id,
		task_list_id: e.listId ?? '',
		title: e.title,
		due_date: e.dueDate,
		has_time: e.hasTime,
		is_completed: e.isCompleted,
		is_starred: e.isStarred,
		is_recurring: e.isRecurring,
		is_template: e.isTemplate,
		completed_at: e.completedAt,
		completed_occurrences_count: e.completedOccurrencesCount,
		position: e.position,
		parent_task_id: e.parentTaskId,
		created_at: e.createdAt,
		updated_at: e.updatedAt,
		deleted_at: e.deletedAt
	};
}

class TaskIndex {
	private _map = new Map<string, TaskIndexEntry>();
	private _version = $state(0);
	private _building = $state(false);
	private _listeners = new Set<() => void>();

	/** Subscribe to index changes (for bridging to Svelte 4 stores). */
	onChange(fn: () => void): () => void {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}

	private _bump(): void {
		this._version++;
		for (const fn of this._listeners) fn();
	}

	// ── Bulk operations ────────────────────────────────────────────

	async build(): Promise<void> {
		if (!cryptoManager.isInitialized()) return;
		this._building = true;
		try {
			const allEncrypted = await taskStore.getAll();
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable, not reactive state
			const map = new Map<string, TaskIndexEntry>();

			for (let i = 0; i < allEncrypted.length; i += BATCH_SIZE) {
				const batch = allEncrypted.slice(i, i + BATCH_SIZE);
				const entries = await Promise.all(batch.map(decryptTaskEntry));
				for (const e of entries) {
					if (!e) continue; // Skip undecryptable entries (stale cross-user data)
					const { id, ...entry } = e;
					map.set(id, entry);
				}
				await new Promise((r) => setTimeout(r, 0));
			}

			this._map = map;
			this._bump();
		} finally {
			this._building = false;
		}
	}

	async rebuild(): Promise<void> {
		this._map.clear();
		this._bump();
		await this.build();
	}

	clear(): void {
		this._map.clear();
		this._bump();
	}

	// ── Incremental updates ────────────────────────────────────────

	update(id: string, entry: TaskIndexEntry): void {
		this._map.set(id, entry);
		this._bump();
	}

	/** Partial update — merges with existing entry. */
	patch(id: string, partial: Partial<TaskIndexEntry>): void {
		const existing = this._map.get(id);
		if (!existing) return;
		this._map.set(id, { ...existing, ...partial });
		this._bump();
	}

	remove(id: string): void {
		if (this._map.delete(id)) {
			this._bump();
		}
	}

	// ── Read API ───────────────────────────────────────────────────

	/** Reactive version counter. Consumers read `void taskIndex.version` to subscribe. */
	get version(): number {
		return this._version;
	}

	/** Active (non-deleted, non-template) task titles sorted by updatedAt desc. Reactive. */
	getAll(): { id: string; title: string }[] {
		void this._version;
		return Array.from(this._map.entries())
			.filter(([, e]) => !e.isDeleted && !e.isTemplate)
			.sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
			.map(([id, e]) => ({ id, title: e.title }));
	}

	getTitle(id: string): string | undefined {
		void this._version;
		return this._map.get(id)?.title;
	}

	/** Get a single entry by id. Reactive. */
	get(id: string): TaskIndexEntry | undefined {
		void this._version;
		return this._map.get(id);
	}

	/** Instant substring search across active task titles (sync). Reactive. */
	search(query: string): TaskListItem[] {
		void this._version;
		if (!query.trim()) return [];
		const q = query.toLowerCase();
		return Array.from(this._map.entries())
			.filter(([, e]) => !e.isDeleted && !e.isTemplate && e.title.toLowerCase().includes(q))
			.sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
			.map(([id, e]) => toListItem(id, e));
	}

	get count(): number {
		void this._version;
		return this._map.size;
	}

	get isBuilding(): boolean {
		return this._building;
	}

	// ── Filtered list API ──────────────────────────────────────────

	/**
	 * Unified filtering + sorting over the in-memory index.
	 *
	 * All operations are synchronous on the Map — no IndexedDB hit, no decryption.
	 * Typical cost: <1ms for 10K entries.
	 */
	getFiltered(options: TaskFilterOptions = {}): TaskFilterResult {
		void this._version;

		const {
			listId,
			section,
			completed,
			starred,
			deleted = false,
			search,
			sortBy = 'position',
			sortDirection = 'asc',
			excludeTemplates = true
		} = options;

		// 1. Filter
		let entries = Array.from(this._map.entries());

		// deleted filter
		entries = entries.filter(([, e]) => e.isDeleted === deleted);

		// template filter
		if (excludeTemplates) {
			entries = entries.filter(([, e]) => !e.isTemplate);
		}

		// list filter
		if (listId) {
			entries = entries.filter(([, e]) => e.listId === listId);
		}

		// section-based date filters
		if (section) {
			/* eslint-disable svelte/prefer-svelte-reactivity -- local date calculations, not reactive state */
			const now = new Date();
			const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const tomorrowStart = new Date(todayStart);
			tomorrowStart.setDate(tomorrowStart.getDate() + 1);
			/* eslint-enable svelte/prefer-svelte-reactivity */

			switch (section) {
				case 'today':
					entries = entries.filter(([, e]) => {
						if (!e.dueDate || e.isCompleted) return false;
						const d = new Date(e.dueDate);
						return d >= todayStart && d < tomorrowStart;
					});
					break;
				case 'overdue':
					entries = entries.filter(([, e]) => {
						if (!e.dueDate || e.isCompleted) return false;
						return new Date(e.dueDate) < todayStart;
					});
					break;
				case 'upcoming':
					entries = entries.filter(([, e]) => {
						if (!e.dueDate || e.isCompleted) return false;
						return new Date(e.dueDate) >= todayStart;
					});
					break;
				case 'no_date':
					entries = entries.filter(([, e]) => !e.dueDate && !e.isCompleted);
					break;
				// 'all' — no additional filter
			}
		}

		// completed filter
		if (completed !== undefined) {
			entries = entries.filter(([, e]) => e.isCompleted === completed);
		}

		// starred filter
		if (starred) {
			entries = entries.filter(([, e]) => e.isStarred);
		}

		// title search
		if (search?.trim()) {
			const q = search.toLowerCase();
			entries = entries.filter(([, e]) => e.title.toLowerCase().includes(q));
		}

		const total = entries.length;

		// 2. Sort
		entries.sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;

			switch (sortBy) {
				case 'alphabetical':
					return dir * a[1].title.localeCompare(b[1].title, 'pl');

				case 'due_date': {
					// Completed tasks to the end
					if (a[1].isCompleted !== b[1].isCompleted) {
						return a[1].isCompleted ? 1 : -1;
					}
					if (!a[1].dueDate && !b[1].dueDate) return a[1].position - b[1].position;
					if (!a[1].dueDate) return 1;
					if (!b[1].dueDate) return -1;
					const dateA = new Date(a[1].dueDate).getTime();
					const dateB = new Date(b[1].dueDate).getTime();
					return dir * (dateA - dateB);
				}

				case 'created_date': {
					const cA = new Date(a[1].createdAt).getTime();
					const cB = new Date(b[1].createdAt).getTime();
					return dir * (cA - cB);
				}

				case 'starred': {
					if (a[1].isStarred === b[1].isStarred) {
						return a[1].position - b[1].position;
					}
					return a[1].isStarred ? -1 : 1;
				}

				case 'position':
				default: {
					// Default: incomplete first, then starred, then by position
					if (a[1].isCompleted !== b[1].isCompleted) {
						return a[1].isCompleted ? 1 : -1;
					}
					if (!a[1].isCompleted && a[1].isStarred !== b[1].isStarred) {
						return a[1].isStarred ? -1 : 1;
					}
					return a[1].position - b[1].position;
				}
			}
		});

		// 3. Convert to TaskListItem
		const items: TaskListItem[] = entries.map(([id, e]) => toListItem(id, e));

		return { items, total };
	}

	/**
	 * AST-driven filtering over the in-memory index.
	 *
	 * Pre-filter (deleted/excludeTemplates/listId/section/completed/starred) narrows
	 * the candidate set, then each remaining entry is mapped to a SearchEntity and
	 * evaluated against the AST. `bodyById` is optional — when present, it populates
	 * `entity.body` so operators that require content (e.g. `has:link`, freetext
	 * substring across description) can match. When absent, those operators evaluate
	 * to false and the caller is expected to be on the title-only path.
	 *
	 * Operator → entity mapping for tasks:
	 *   - `is:starred`   → `entity.flags.starred   = entry.isStarred`
	 *   - `is:completed` → `entity.flags.completed = entry.isCompleted`
	 *   - `is:overdue`   → evaluator derives from `entity.dueAt < now && !completed && !trashed`
	 *   - `is:pinned`    → undefined (tasks have no pin concept) → matches nothing
	 *   - `tag:` / `folder:` → resolvers are empty → match nothing (graceful degradation)
	 *   - `list:`        → `entity.listId === ctx.listIdByName.get(value)`
	 *   - `due:`         → `entity.dueAt = entry.dueDate`
	 *
	 * `entity.flags.trashed = entry.isDeleted` is plumbed for the `is:overdue`
	 * derivation only — there is no public `is:trashed` operator (the active/trash
	 * split is handled by the pre-filter above).
	 */
	getFilteredByAst(
		ast: QueryAST,
		ctx: SearchContext,
		options: TaskFilterByAstOptions = {}
	): TaskFilterResult {
		void this._version;

		const {
			listId,
			section,
			completed,
			starred,
			deleted = false,
			sortBy = 'position',
			sortDirection = 'asc',
			excludeTemplates = true,
			bodyById
		} = options;

		// 1. Pre-filter (cheap shadow-index checks before AST evaluation)
		let entries = Array.from(this._map.entries());

		entries = entries.filter(([, e]) => e.isDeleted === deleted);

		if (excludeTemplates) {
			entries = entries.filter(([, e]) => !e.isTemplate);
		}

		if (listId) {
			entries = entries.filter(([, e]) => e.listId === listId);
		}

		if (section) {
			/* eslint-disable svelte/prefer-svelte-reactivity -- local date calculations, not reactive state */
			const now = new Date();
			const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const tomorrowStart = new Date(todayStart);
			tomorrowStart.setDate(tomorrowStart.getDate() + 1);
			/* eslint-enable svelte/prefer-svelte-reactivity */

			switch (section) {
				case 'today':
					entries = entries.filter(([, e]) => {
						if (!e.dueDate || e.isCompleted) return false;
						const d = new Date(e.dueDate);
						return d >= todayStart && d < tomorrowStart;
					});
					break;
				case 'overdue':
					entries = entries.filter(([, e]) => {
						if (!e.dueDate || e.isCompleted) return false;
						return new Date(e.dueDate) < todayStart;
					});
					break;
				case 'upcoming':
					entries = entries.filter(([, e]) => {
						if (!e.dueDate || e.isCompleted) return false;
						return new Date(e.dueDate) >= todayStart;
					});
					break;
				case 'no_date':
					entries = entries.filter(([, e]) => !e.dueDate && !e.isCompleted);
					break;
			}
		}

		if (completed !== undefined) {
			entries = entries.filter(([, e]) => e.isCompleted === completed);
		}

		if (starred) {
			entries = entries.filter(([, e]) => e.isStarred);
		}

		// 2. AST evaluation
		entries = entries.filter(([id, e]) => evaluate(ast, toSearchEntity(id, e, bodyById), ctx));

		// 3. Sort (same logic as getFiltered)
		entries.sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;

			switch (sortBy) {
				case 'alphabetical':
					return dir * a[1].title.localeCompare(b[1].title, 'pl');

				case 'due_date': {
					if (a[1].isCompleted !== b[1].isCompleted) {
						return a[1].isCompleted ? 1 : -1;
					}
					if (!a[1].dueDate && !b[1].dueDate) return a[1].position - b[1].position;
					if (!a[1].dueDate) return 1;
					if (!b[1].dueDate) return -1;
					const dateA = new Date(a[1].dueDate).getTime();
					const dateB = new Date(b[1].dueDate).getTime();
					return dir * (dateA - dateB);
				}

				case 'created_date': {
					const cA = new Date(a[1].createdAt).getTime();
					const cB = new Date(b[1].createdAt).getTime();
					return dir * (cA - cB);
				}

				case 'starred': {
					if (a[1].isStarred === b[1].isStarred) {
						return a[1].position - b[1].position;
					}
					return a[1].isStarred ? -1 : 1;
				}

				case 'position':
				default: {
					if (a[1].isCompleted !== b[1].isCompleted) {
						return a[1].isCompleted ? 1 : -1;
					}
					if (!a[1].isCompleted && a[1].isStarred !== b[1].isStarred) {
						return a[1].isStarred ? -1 : 1;
					}
					return a[1].position - b[1].position;
				}
			}
		});

		const total = entries.length;
		const items: TaskListItem[] = entries.map(([id, e]) => toListItem(id, e));

		return { items, total };
	}
}

function toSearchEntity(
	id: string,
	entry: TaskIndexEntry,
	bodyById: Map<string, string> | undefined
): SearchEntity {
	return {
		id,
		title: entry.title,
		body: bodyById?.get(id),
		tagIds: [],
		folderId: null,
		listId: entry.listId ?? null,
		createdAt: new Date(entry.createdAt),
		updatedAt: new Date(entry.updatedAt),
		dueAt: entry.dueDate ? new Date(entry.dueDate) : null,
		flags: {
			starred: entry.isStarred,
			completed: entry.isCompleted,
			trashed: entry.isDeleted
		}
	};
}

export const taskIndex = new TaskIndex();

// Legacy alias
export { type TaskIndexEntry as TaskTitleEntry };
export const taskTitleIndex = taskIndex;
