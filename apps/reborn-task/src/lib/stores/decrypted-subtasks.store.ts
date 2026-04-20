import { writable, get } from 'svelte/store';
import { subtaskStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type { Subtask, SubtaskStoredLocal } from '@reborn/types';

const logger = createLogger('DecryptedSubtasksStore-V2');

/**
 * Decrypts a single subtask
 */
async function decryptSubtask(subtask: SubtaskStoredLocal): Promise<Subtask | null> {
	try {
		if (!cryptoManager.isInitialized()) {
			logger.warn('CryptoManager not initialized, skipping decryption');
			return null;
		}

		const decrypted: Subtask = {
			id: subtask.id,
			task_id: subtask.task_id,
			title: await cryptoManager.decryptText(subtask.name_encrypted),
			is_completed: subtask.is_completed === 1,
			position: subtask.position,
			created_at: subtask.created_at,
			updated_at: subtask.updated_at
		};

		return decrypted;
	} catch (error: unknown) {
		logger.error(`Failed to decrypt subtask ${subtask.id}:`, error);
		return null;
	}
}

/**
 * Store containing all decrypted subtasks
 */
export const decryptedSubtasks = writable<Subtask[]>([]);

// Debounce function
function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

// Function to refresh decrypted subtasks
export async function refreshDecryptedSubtasks() {
	if (!cryptoManager.isInitialized()) {
		logger.debug('CryptoManager not initialized yet');
		decryptedSubtasks.set([]);
		return;
	}

	const $encryptedSubtasks = get(subtaskStore.items);
	const activeSubtasks = $encryptedSubtasks.filter((st) => !st.deleted_at);
	const decryptPromises = activeSubtasks.map(decryptSubtask);
	const decrypted = await Promise.all(decryptPromises);

	decryptedSubtasks.set(decrypted.filter(Boolean) as Subtask[]);
}

// Debounced refresh with minimal delay for better drag & drop responsiveness
const debouncedRefresh = debounce(refreshDecryptedSubtasks, 10);

// Subscribe to encrypted store and auto-decrypt
subtaskStore.items.subscribe(() => {
	if (cryptoManager.isInitialized()) {
		debouncedRefresh();
	}
});

/**
 * Get decrypted subtasks for a specific task
 */
export function getSubtasksForTask(taskId: string): Subtask[] {
	const $allSubtasks = get(decryptedSubtasks);
	return $allSubtasks.filter((st) => st.task_id === taskId).sort((a, b) => a.position - b.position);
}

/**
 * Creates a readable store that returns decrypted subtasks for a specific task
 * This store automatically updates when subtasks change
 */
export function decryptedSubtasksByTask(taskId: string) {
	let unsubscribe: (() => void) | null = null;

	const customSubscribe = (run: (value: Subtask[]) => void) => {
		// Subscribe to the main decrypted subtasks store
		unsubscribe = decryptedSubtasks.subscribe(($allSubtasks) => {
			const taskSubtasks = $allSubtasks
				.filter((st) => st.task_id === taskId)
				.sort((a, b) => a.position - b.position);

			logger.debug('Filtered subtasks for task:', {
				taskId,
				count: taskSubtasks.length,
				subtasks: taskSubtasks.map((st) => ({ id: st.id, title: st.title }))
			});

			run(taskSubtasks);
		});

		// Return cleanup function
		return () => {
			if (unsubscribe) {
				unsubscribe();
			}
		};
	};

	return {
		subscribe: customSubscribe
	};
}
