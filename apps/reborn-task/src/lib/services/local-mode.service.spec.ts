import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The local-only -> account upgrade re-stamps every local entity with the new
 * account's user id and flags it pending, so the offline-op queue uploads it and
 * Task's user_id-keyed list queries find it under the new account. These tests
 * pin down that invariant for lists, tasks and subtasks.
 */

vi.mock('@reborn/storage', () => ({
	listStore: { getAll: vi.fn(), save: vi.fn() },
	taskStore: { getAll: vi.fn(), save: vi.fn() },
	subtaskStore: { getAll: vi.fn(), save: vi.fn() }
}));

vi.mock('@reborn/utils', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	})
}));

import { listStore, taskStore, subtaskStore } from '@reborn/storage';
import { markAllLocalDataForUpload } from './local-mode.service';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function row(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		user_id: DEVICE_ID,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		sync_version: 1,
		sync_status: 'synced' as const,
		...extra
	};
}

describe('markAllLocalDataForUpload', () => {
	const listGetAll = vi.mocked(listStore.getAll);
	const listSave = vi.mocked(listStore.save);
	const taskGetAll = vi.mocked(taskStore.getAll);
	const taskSave = vi.mocked(taskStore.save);
	const subtaskGetAll = vi.mocked(subtaskStore.getAll);
	const subtaskSave = vi.mocked(subtaskStore.save);

	beforeEach(() => {
		vi.clearAllMocks();
		listSave.mockResolvedValue(undefined as never);
		taskSave.mockResolvedValue(undefined as never);
		subtaskSave.mockResolvedValue(undefined as never);
	});

	it('rewrites user_id to the account id and flags every entity pending', async () => {
		listGetAll.mockResolvedValue([row('list-1', { name_encrypted: 'x', is_default: true })] as never);
		taskGetAll.mockResolvedValue([row('task-1', { task_list_id: 'list-1', title_encrypted: 'y' })] as never);
		subtaskGetAll.mockResolvedValue([row('sub-1', { task_id: 'task-1', name_encrypted: 'z' })] as never);

		await markAllLocalDataForUpload(ACCOUNT_ID);

		expect(listSave).toHaveBeenCalledTimes(1);
		expect(taskSave).toHaveBeenCalledTimes(1);
		expect(subtaskSave).toHaveBeenCalledTimes(1);

		for (const save of [listSave, taskSave, subtaskSave]) {
			const saved = save.mock.calls[0][0] as { user_id: string; sync_status: string };
			expect(saved.user_id).toBe(ACCOUNT_ID);
			expect(saved.sync_status).toBe('pending');
		}
	});

	it('preserves all other fields (id, task_list_id, is_default) while re-stamping', async () => {
		listGetAll.mockResolvedValue([
			row('list-1', { name_encrypted: 'enc', is_default: true, order_index: 3 })
		] as never);
		taskGetAll.mockResolvedValue([] as never);
		subtaskGetAll.mockResolvedValue([] as never);

		await markAllLocalDataForUpload(ACCOUNT_ID);

		const saved = listSave.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(saved.id).toBe('list-1');
		expect(saved.name_encrypted).toBe('enc');
		expect(saved.is_default).toBe(true);
		expect(saved.order_index).toBe(3);
	});

	it('is a no-op (no saves) when there is no local data', async () => {
		listGetAll.mockResolvedValue([] as never);
		taskGetAll.mockResolvedValue([] as never);
		subtaskGetAll.mockResolvedValue([] as never);

		await markAllLocalDataForUpload(ACCOUNT_ID);

		expect(listSave).not.toHaveBeenCalled();
		expect(taskSave).not.toHaveBeenCalled();
		expect(subtaskSave).not.toHaveBeenCalled();
	});
});
