import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TaskEncryptedBooleans, TaskSensitiveMetadata } from '@reborn/types';

/**
 * Recovery half of the 2026-05-10 fix: the reconciler walks IDB after each
 * unlock and overwrites shadow indexes that drifted from the metadata
 * bundle's truth. These tests pin down its key invariants:
 *
 *   - decrypt-failure NEVER overwrites IDB (overwriting was the bug we fixed)
 *   - drift triggers a save, equality skips the save
 *   - tasks without `metadata_encrypted` are left alone
 *   - reconciler is a no-op when crypto is not initialized
 */

vi.mock('@reborn/crypto', () => ({
	cryptoManager: {
		isInitialized: vi.fn(),
		decryptObject: vi.fn()
	}
}));

vi.mock('@reborn/storage', () => ({
	taskStore: {
		getAll: vi.fn(),
		save: vi.fn()
	}
}));

vi.mock('@reborn/utils', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	})
}));

import { cryptoManager } from '@reborn/crypto';
import { taskStore } from '@reborn/storage';
import { verifyAndRebuildLocalShadowIndexes } from './shadow-index-reconciler.service';

function makeTask(overrides: Partial<TaskEncryptedBooleans> = {}): TaskEncryptedBooleans {
	return {
		id: 'task-1',
		user_id: 'user-1',
		task_list_id: 'list-1',
		title_encrypted: 'iv:cipher',
		metadata_encrypted: 'iv:meta',
		is_template: false,
		is_completed: false,
		is_starred: false,
		due_date: null,
		position: 0,
		sync_version: 1,
		created_at: '2026-05-10T00:00:00.000Z',
		updated_at: '2026-05-10T00:00:00.000Z',
		deleted_at: null,
		...overrides
	} as unknown as TaskEncryptedBooleans;
}

describe('verifyAndRebuildLocalShadowIndexes', () => {
	const isInitializedMock = vi.mocked(cryptoManager.isInitialized);
	const decryptObjectMock = vi.mocked(cryptoManager.decryptObject);
	const getAllMock = vi.mocked(taskStore.getAll);
	const saveMock = vi.mocked(taskStore.save);

	beforeEach(() => {
		isInitializedMock.mockReset();
		decryptObjectMock.mockReset();
		getAllMock.mockReset();
		saveMock.mockReset();
	});

	it('is a no-op and reports zero scanned when crypto is not initialized', async () => {
		isInitializedMock.mockReturnValue(false);
		const result = await verifyAndRebuildLocalShadowIndexes();
		expect(result.scanned).toBe(0);
		expect(result.repaired).toBe(0);
		expect(getAllMock).not.toHaveBeenCalled();
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('repairs a drifted task when decrypted metadata disagrees with IDB shadow indexes', async () => {
		isInitializedMock.mockReturnValue(true);
		const corruptedTask = makeTask({
			id: 'corrupt-1',
			is_completed: false,
			is_starred: false,
			due_date: null
		});
		getAllMock.mockResolvedValue([corruptedTask]);
		const truth: TaskSensitiveMetadata = {
			is_completed: true,
			is_starred: true,
			is_recurring: false,
			due_date: '2026-05-15T00:00:00.000Z'
		};
		decryptObjectMock.mockResolvedValue(truth);

		const result = await verifyAndRebuildLocalShadowIndexes();

		expect(result.scanned).toBe(1);
		expect(result.repaired).toBe(1);
		expect(saveMock).toHaveBeenCalledTimes(1);
		const saved = saveMock.mock.calls[0][0] as TaskEncryptedBooleans;
		expect(saved.is_completed).toBe(true);
		expect(saved.is_starred).toBe(true);
		expect(saved.due_date).toBe('2026-05-15T00:00:00.000Z');
	});

	it('skips save when shadow indexes already match the metadata bundle', async () => {
		isInitializedMock.mockReturnValue(true);
		const consistentTask = makeTask({
			is_completed: true,
			is_starred: false,
			due_date: '2026-06-01T00:00:00.000Z'
		});
		getAllMock.mockResolvedValue([consistentTask]);
		decryptObjectMock.mockResolvedValue({
			is_completed: true,
			is_starred: false,
			due_date: '2026-06-01T00:00:00.000Z'
		} as TaskSensitiveMetadata);

		const result = await verifyAndRebuildLocalShadowIndexes();

		expect(result.scanned).toBe(1);
		expect(result.repaired).toBe(0);
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('does NOT overwrite IDB when decryption fails (key mismatch)', async () => {
		isInitializedMock.mockReturnValue(true);
		const task = makeTask({ is_completed: true, is_starred: true });
		getAllMock.mockResolvedValue([task]);
		decryptObjectMock.mockRejectedValue(new Error('OperationError'));

		const result = await verifyAndRebuildLocalShadowIndexes();

		expect(result.scanned).toBe(1);
		expect(result.repaired).toBe(0);
		expect(result.skipped).toBe(1);
		expect(saveMock).not.toHaveBeenCalled();
	});

	it('counts tasks without metadata_encrypted separately and leaves them alone', async () => {
		isInitializedMock.mockReturnValue(true);
		const legacyTask = makeTask({ id: 'legacy-1', metadata_encrypted: '' as string });
		getAllMock.mockResolvedValue([legacyTask]);

		const result = await verifyAndRebuildLocalShadowIndexes();

		expect(result.scanned).toBe(1);
		expect(result.skippedNoMetadata).toBe(1);
		expect(result.repaired).toBe(0);
		expect(decryptObjectMock).not.toHaveBeenCalled();
		expect(saveMock).not.toHaveBeenCalled();
	});
});
