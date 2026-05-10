import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TaskEncrypted, TaskSensitiveMetadata } from '@reborn/types';
import { defaultShadowIndexes, rebuildShadowIndexes } from './shadow-indexes';

/**
 * Regression tests for the 2026-05-10 incident where the PWA Task UI showed
 * every task with `is_completed=false / due_date=null` after a session-expiry
 * unlock. Root cause: `rebuildShadowIndexes()` silently fell back to default
 * shadow indexes whenever crypto was not ready or `decryptObject` threw,
 * corrupting IDB. This suite locks in the new contract:
 *
 *   - missing `metadata_encrypted` → defaults (legitimate backward-compat)
 *   - crypto not initialized → throw
 *   - decrypt fails → throw
 *   - decrypt ok → values from metadata bundle
 */

vi.mock('@reborn/crypto', () => ({
	cryptoManager: {
		isInitialized: vi.fn(),
		decryptObject: vi.fn()
	}
}));

import { cryptoManager } from '@reborn/crypto';

const baseEncryptedTask: TaskEncrypted = {
	id: 'task-1',
	user_id: 'user-1',
	task_list_id: 'list-1',
	title_encrypted: 'iv:cipher',
	metadata_encrypted: 'iv:meta-cipher',
	is_template: 0,
	position: 0,
	sync_version: 1,
	created_at: '2026-05-10T00:00:00.000Z',
	updated_at: '2026-05-10T00:00:00.000Z',
	deleted_at: null
} as unknown as TaskEncrypted;

const richMetadata: TaskSensitiveMetadata = {
	is_completed: true,
	is_starred: true,
	is_recurring: true,
	due_date: '2026-05-15T00:00:00.000Z',
	has_time: false,
	completed_at: '2026-05-12T10:00:00.000Z',
	completed_occurrences_count: 3
};

describe('defaultShadowIndexes', () => {
	it('returns false/null defaults and converts is_template to boolean', () => {
		const result = defaultShadowIndexes({ ...baseEncryptedTask, is_template: 1 });
		expect(result.is_completed).toBe(false);
		expect(result.is_starred).toBe(false);
		expect(result.is_template).toBe(true);
		expect(result.due_date).toBeNull();
	});

	it('preserves passthrough fields (id, ciphertext, position, sync_version)', () => {
		const result = defaultShadowIndexes(baseEncryptedTask);
		expect(result.id).toBe('task-1');
		expect(result.title_encrypted).toBe('iv:cipher');
		expect(result.metadata_encrypted).toBe('iv:meta-cipher');
		expect(result.position).toBe(0);
		expect(result.sync_version).toBe(1);
	});
});

describe('rebuildShadowIndexes', () => {
	const isInitializedMock = vi.mocked(cryptoManager.isInitialized);
	const decryptObjectMock = vi.mocked(cryptoManager.decryptObject);

	beforeEach(() => {
		isInitializedMock.mockReset();
		decryptObjectMock.mockReset();
	});

	it('falls back to defaults when metadata_encrypted is missing (backward compat)', async () => {
		const task = { ...baseEncryptedTask, metadata_encrypted: '' as string };
		const result = await rebuildShadowIndexes(task);
		expect(result.is_completed).toBe(false);
		expect(result.is_starred).toBe(false);
		expect(result.due_date).toBeNull();
		expect(isInitializedMock).not.toHaveBeenCalled();
		expect(decryptObjectMock).not.toHaveBeenCalled();
	});

	it('throws when cryptoManager is not initialized (no silent default fallback)', async () => {
		isInitializedMock.mockReturnValue(false);
		await expect(rebuildShadowIndexes(baseEncryptedTask)).rejects.toThrow(
			/crypto-not-ready/
		);
		expect(decryptObjectMock).not.toHaveBeenCalled();
	});

	it('throws when decryptObject rejects (no silent default fallback)', async () => {
		isInitializedMock.mockReturnValue(true);
		decryptObjectMock.mockRejectedValue(new Error('OperationError'));
		await expect(rebuildShadowIndexes(baseEncryptedTask)).rejects.toThrow(
			/decrypt-failed/
		);
	});

	it('returns metadata-derived shadow indexes on success', async () => {
		isInitializedMock.mockReturnValue(true);
		decryptObjectMock.mockResolvedValue(richMetadata);
		const result = await rebuildShadowIndexes(baseEncryptedTask);
		expect(result.is_completed).toBe(true);
		expect(result.is_starred).toBe(true);
		expect(result.is_recurring).toBe(true);
		expect(result.due_date).toBe('2026-05-15T00:00:00.000Z');
	});

	it('coerces is_template BooleanInt → boolean even on success path', async () => {
		isInitializedMock.mockReturnValue(true);
		decryptObjectMock.mockResolvedValue(richMetadata);
		const templateTask = { ...baseEncryptedTask, is_template: 1 } as TaskEncrypted;
		const result = await rebuildShadowIndexes(templateTask);
		expect(result.is_template).toBe(true);
	});
});
