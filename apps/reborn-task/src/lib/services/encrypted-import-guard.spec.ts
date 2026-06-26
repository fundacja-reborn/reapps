import { describe, it, expect, vi } from 'vitest';
import { isEncryptedBackupReadable } from './encrypted-import-guard';

/**
 * The probe order is [list name, task title, subtask name]; `undefined`/`null`
 * stand in for "this entity kind has no rows in the backup".
 */
describe('isEncryptedBackupReadable (reborn-task cross-account guard)', () => {
	const decryptOk = async (ct: string) => `plain:${ct}`;
	const decryptFail = async () => {
		throw new Error('OperationError'); // AES-GCM auth-tag mismatch (wrong key)
	};

	it('returns true and stops at the first decryptable probe (same account)', async () => {
		const decrypt = vi.fn(decryptOk);
		expect(await isEncryptedBackupReadable(['a', 'b', 'c'], decrypt)).toBe(true);
		// One successful decrypt is enough - no need to probe the other kinds.
		expect(decrypt).toHaveBeenCalledTimes(1);
	});

	it('returns false when no probe decrypts (cross-account backup)', async () => {
		const decrypt = vi.fn(decryptFail);
		expect(await isEncryptedBackupReadable(['a', 'b', 'c'], decrypt)).toBe(false);
		expect(decrypt).toHaveBeenCalledTimes(3);
	});

	it('skips empty/missing probes and tries the next entity kind', async () => {
		// No lists, no tasks - only the subtask probe is present and valid.
		const decrypt = vi.fn(decryptOk);
		expect(await isEncryptedBackupReadable([undefined, null, 's'], decrypt)).toBe(true);
		expect(decrypt).toHaveBeenCalledTimes(1);
		expect(decrypt).toHaveBeenCalledWith('s');
	});

	it('treats an empty backup as readable without probing', async () => {
		const decrypt = vi.fn(decryptFail);
		expect(await isEncryptedBackupReadable([undefined, null, undefined], decrypt)).toBe(true);
		expect(decrypt).not.toHaveBeenCalled();
	});

	it('falls through a corrupt leading probe to a valid later one (same account)', async () => {
		// First field corrupt, but a later kind decrypts → still same account.
		const decrypt = vi.fn(async (ct: string) => {
			if (ct === 'bad') throw new Error('OperationError');
			return `plain:${ct}`;
		});
		expect(await isEncryptedBackupReadable(['bad', 'good'], decrypt)).toBe(true);
		expect(decrypt).toHaveBeenCalledTimes(2);
	});
});
