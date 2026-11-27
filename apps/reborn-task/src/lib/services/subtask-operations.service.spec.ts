import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * createSubtasks() backs "Save to my tasks" from a share view: it writes the
 * snapshot's subtasks in one go, keeping each tick, and refreshes the stores
 * once. These tests pin down order, positions, the completion state (both the
 * encrypted metadata and the local shadow index), the sync queue entry without
 * the shadow index, and that one failing subtask does not stop the rest.
 */

vi.mock('@reborn/crypto', () => ({
	cryptoManager: {
		isInitialized: vi.fn(),
		encryptText: vi.fn(),
		encryptObject: vi.fn()
	}
}));

vi.mock('@reborn/storage', () => ({
	subtaskStore: {
		save: vi.fn(),
		refreshItems: vi.fn()
	},
	subtaskQueries: {
		byTask: vi.fn()
	},
	addOperation: vi.fn()
}));

vi.mock('@reborn/utils', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	})
}));

vi.mock('$lib/stores/decrypted-subtasks.store', () => ({
	refreshDecryptedSubtasks: vi.fn()
}));

vi.mock('./sync.service', () => ({
	syncService: { scheduleSyncSoon: vi.fn() }
}));

import { cryptoManager } from '@reborn/crypto';
import { subtaskStore, subtaskQueries, addOperation } from '@reborn/storage';
import { refreshDecryptedSubtasks } from '$lib/stores/decrypted-subtasks.store';
import { syncService } from './sync.service';
import { subtaskOperationsService } from './subtask-operations.service';

const savedSubtasks = () =>
	vi.mocked(subtaskStore.save).mock.calls.map(([subtask]) => subtask as unknown as Record<string, unknown>);

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(cryptoManager.isInitialized).mockReturnValue(true);
	vi.mocked(cryptoManager.encryptText).mockImplementation(async (text: string) => `enc(${text})`);
	vi.mocked(cryptoManager.encryptObject).mockImplementation(
		async (value: unknown) => `enc(${JSON.stringify(value)})`
	);
	vi.mocked(subtaskQueries.byTask).mockResolvedValue([]);
});

describe('subtaskOperationsService.createSubtasks', () => {
	it('creates the subtasks in order, after the existing ones, keeping each tick', async () => {
		vi.mocked(subtaskQueries.byTask).mockResolvedValue([
			{ position: 3000 },
			{ position: 1000 }
		] as never);

		const created = await subtaskOperationsService.createSubtasks('task-1', [
			{ title: 'passport', is_completed: true },
			{ title: ' tickets ', is_completed: false }
		]);

		expect(created).toBe(2);
		const saved = savedSubtasks();
		expect(saved.map((s) => [s.name_encrypted, s.position, s.is_completed])).toEqual([
			['enc(passport)', 4000, 1],
			['enc(tickets)', 5000, 0]
		]);
		expect(saved.map((s) => s.metadata_encrypted)).toEqual([
			'enc({"is_completed":true})',
			'enc({"is_completed":false})'
		]);
		for (const subtask of saved) {
			expect(subtask).toMatchObject({ task_id: 'task-1', sync_status: 'pending', deleted_at: null });
		}
	});

	it('queues a create per subtask without the local shadow index', async () => {
		await subtaskOperationsService.createSubtasks('task-1', [
			{ title: 'a', is_completed: true },
			{ title: 'b', is_completed: false }
		]);

		const ops = vi.mocked(addOperation).mock.calls.map(([op]) => op);
		expect(ops).toHaveLength(2);
		for (const op of ops) {
			expect(op).toMatchObject({ type: 'create', entityType: 'sub_task' });
			expect(op.data).not.toHaveProperty('is_completed');
		}
		expect(ops.map((op) => op.entityId)).toEqual(savedSubtasks().map((s) => s.id));
	});

	it('refreshes the stores and schedules a sync once for the whole batch', async () => {
		await subtaskOperationsService.createSubtasks('task-1', [
			{ title: 'a', is_completed: false },
			{ title: 'b', is_completed: false },
			{ title: 'c', is_completed: false }
		]);

		expect(subtaskStore.refreshItems).toHaveBeenCalledTimes(1);
		expect(refreshDecryptedSubtasks).toHaveBeenCalledTimes(1);
		expect(syncService.scheduleSyncSoon).toHaveBeenCalledTimes(1);
	});

	it('skips items without a title', async () => {
		const created = await subtaskOperationsService.createSubtasks('task-1', [
			{ title: '  ', is_completed: false },
			{ title: 'keep', is_completed: false }
		]);

		expect(created).toBe(1);
		expect(savedSubtasks().map((s) => s.name_encrypted)).toEqual(['enc(keep)']);
	});

	it('keeps going when one subtask fails and reports how many were created', async () => {
		vi.mocked(subtaskStore.save)
			.mockResolvedValueOnce(undefined as never)
			.mockRejectedValueOnce(new Error('disk full'))
			.mockResolvedValueOnce(undefined as never);

		const created = await subtaskOperationsService.createSubtasks('task-1', [
			{ title: 'a', is_completed: false },
			{ title: 'b', is_completed: false },
			{ title: 'c', is_completed: false }
		]);

		expect(created).toBe(2);
		expect(addOperation).toHaveBeenCalledTimes(2);
	});

	it('does nothing for an empty list', async () => {
		expect(await subtaskOperationsService.createSubtasks('task-1', [])).toBe(0);
		expect(subtaskStore.save).not.toHaveBeenCalled();
		expect(subtaskStore.refreshItems).not.toHaveBeenCalled();
		expect(syncService.scheduleSyncSoon).not.toHaveBeenCalled();
	});

	it('refuses to run while the key is locked', async () => {
		vi.mocked(cryptoManager.isInitialized).mockReturnValue(false);
		await expect(
			subtaskOperationsService.createSubtasks('task-1', [{ title: 'a', is_completed: false }])
		).rejects.toThrow();
		expect(subtaskStore.save).not.toHaveBeenCalled();
	});
});
