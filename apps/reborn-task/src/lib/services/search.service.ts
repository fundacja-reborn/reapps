/**
 * Search Service for Zero Knowledge E2E Architecture
 *
 * This service implements secure in-memory search for encrypted tasks.
 * All search operations are performed on decrypted data in memory only.
 * No search indexes or unencrypted data are stored in IndexedDB.
 *
 * Security principle: Search can only be performed after decryption,
 * ensuring complete Zero Knowledge compliance.
 */

import { taskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type { TaskDecrypted, TaskEncryptedBooleans, TaskSensitiveMetadata } from '@reborn/types';
import { get } from 'svelte/store';

const logger = createLogger('SearchService');

export interface SearchOptions {
	batchSize?: number;
	maxResults?: number;
	signal?: AbortSignal;
	searchInDescription?: boolean;
}

export class SearchService {
	private currentSearch: AbortController | null = null;
	private readonly DEFAULT_BATCH_SIZE = 10;
	private readonly DEFAULT_MAX_RESULTS = 20;

	/**
	 * Search tasks in batches, yielding results as they are found
	 * This allows for responsive UI updates during search
	 */
	async *searchTasksInBatches(
		query: string,
		options: SearchOptions = {}
	): AsyncGenerator<TaskDecrypted> {
		// Cancel any ongoing search
		this.cancelCurrentSearch();

		// Create new abort controller
		this.currentSearch = new AbortController();
		const signal = options.signal || this.currentSearch.signal;

		const batchSize = options.batchSize || this.DEFAULT_BATCH_SIZE;
		const maxResults = options.maxResults || this.DEFAULT_MAX_RESULTS;
		const searchInDescription = options.searchInDescription ?? true;

		// Normalize search query
		const normalizedQuery = query.toLowerCase().trim();
		if (!normalizedQuery) {
			logger.info('Empty search query, returning no results');
			return;
		}

		logger.info('Starting search', {
			query: normalizedQuery,
			batchSize,
			maxResults,
			searchInDescription
		});

		// Check if crypto is initialized
		if (!cryptoManager.isInitialized()) {
			logger.warn('CryptoManager not initialized, cannot perform search');
			return;
		}

		// Get all encrypted tasks from store
		const allTasks = get(taskStore.items);
		const activeTasks = allTasks.filter((task) => !task.deleted_at);

		logger.info('Total tasks to search', {
			total: allTasks.length,
			active: activeTasks.length
		});

		let foundCount = 0;
		let processedCount = 0;

		// Process tasks in batches
		for (let i = 0; i < activeTasks.length; i += batchSize) {
			// Check if search was cancelled
			if (signal.aborted) {
				logger.info('Search cancelled', { processedCount, foundCount });
				return;
			}

			// Get batch of tasks
			const batch = activeTasks.slice(i, i + batchSize);

			// Decrypt and search batch
			for (const encryptedTask of batch) {
				// Check cancellation again
				if (signal.aborted) {
					return;
				}

				try {
					// Decrypt task
					const decryptedTask = await this.decryptTask(encryptedTask);
					if (!decryptedTask) {
						continue;
					}

					// Search in title and optionally in description
					const titleMatch = decryptedTask.title.toLowerCase().includes(normalizedQuery);
					const descriptionMatch =
						searchInDescription &&
						decryptedTask.description?.toLowerCase().includes(normalizedQuery);

					if (titleMatch || descriptionMatch) {
						foundCount++;
						yield decryptedTask;

						// Stop if we've found enough results
						if (foundCount >= maxResults) {
							logger.info('Max results reached', { foundCount, processedCount });
							return;
						}
					}
				} catch (error: unknown) {
					logger.error('Failed to process task during search', {
						taskId: encryptedTask.id,
						error
					});
				}

				processedCount++;
			}

			// Small pause between batches to prevent UI blocking
			// This allows other operations to run
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		logger.info('Search completed', {
			query: normalizedQuery,
			foundCount,
			processedCount
		});
	}

	/**
	 * Cancel the current search operation
	 */
	cancelCurrentSearch(): void {
		if (this.currentSearch) {
			this.currentSearch.abort();
			this.currentSearch = null;
			logger.info('Search cancelled');
		}
	}

	/**
	 * Decrypt a single task
	 */
	private async decryptTask(encryptedTask: TaskEncryptedBooleans): Promise<TaskDecrypted | null> {
		try {
			// Decrypt metadata for sensitive fields
			let meta: Partial<TaskSensitiveMetadata> = {};
			if (encryptedTask.metadata_encrypted) {
				try {
					meta = await cryptoManager.decryptObject<TaskSensitiveMetadata>(
						encryptedTask.metadata_encrypted
					);
				} catch {
					// fallback to shadow indexes
				}
			}

			const decrypted: TaskDecrypted = {
				id: encryptedTask.id,
				task_list_id: encryptedTask.task_list_id,
				title: await cryptoManager.decryptText(encryptedTask.title_encrypted),
				description: encryptedTask.description_encrypted
					? await cryptoManager.decryptText(encryptedTask.description_encrypted)
					: undefined,
				due_date: meta.due_date ?? encryptedTask.due_date,
				has_time: meta.has_time,
				is_completed: meta.is_completed ?? encryptedTask.is_completed,
				is_starred: meta.is_starred ?? encryptedTask.is_starred,
				is_recurring: meta.is_recurring ?? encryptedTask.is_recurring ?? false,
				recurrence_rule: encryptedTask.recurrence_rule_encrypted
					? await cryptoManager.decryptText(encryptedTask.recurrence_rule_encrypted)
					: undefined,
				is_template: encryptedTask.is_template,
				completed_at: meta.completed_at,
				next_occurrence_date: meta.next_occurrence_date,
				completed_occurrences_count: meta.completed_occurrences_count,
				position: encryptedTask.position,
				created_at: encryptedTask.created_at,
				updated_at: encryptedTask.updated_at,
				deleted_at: encryptedTask.deleted_at || undefined
			};

			return decrypted;
		} catch (error: unknown) {
			logger.error('Failed to decrypt task', {
				taskId: encryptedTask.id,
				error
			});
			return null;
		}
	}

	/**
	 * Get search statistics for debugging
	 */
	getSearchStats(): { isSearching: boolean } {
		return {
			isSearching: this.currentSearch !== null && !this.currentSearch.signal.aborted
		};
	}
}

// Export singleton instance
export const searchService = new SearchService();
