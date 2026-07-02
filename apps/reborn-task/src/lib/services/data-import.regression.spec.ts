import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: production exports occasionally carried `user_id: null` (or a
 * missing user_id) due to legacy IDB writes / sync racing auth restoration.
 * The importer overwrites user_id with the current account's id on save —
 * validating the file value first is dead weight. The fix sets user_id
 * BEFORE `safeParse` so legacy backups get accepted. Mirrors the same fix
 * in reborn-notes (`export-import.service.ts`). See guideline 44.
 */
function readSource(relative: string): string {
	return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('reborn-task data-import — user_id resilience (regression)', () => {
	it('exposes a withUserId helper that sets user_id on record inputs', () => {
		const src = readSource('./data-import.service.ts');
		expect(src).toMatch(/function\s+withUserId\s*\(\s*raw:\s*unknown\s*,\s*userId:\s*string\s*\)/);
		// Returns a fresh record with user_id stamped in.
		expect(src).toMatch(/user_id:\s*userId/);
	});

	it('encrypted import wraps each entity through withUserId before safeParse', () => {
		const src = readSource('./data-import.service.ts');
		const encStart = src.indexOf('private async importEncrypted');
		const encEnd = src.indexOf('private async importDecrypted');
		expect(encStart).toBeGreaterThan(-1);
		expect(encEnd).toBeGreaterThan(encStart);
		const enc = src.slice(encStart, encEnd);

		// Three loops (lists, tasks, subtasks). Each must thread withUserId
		// through whatever pre-processing it does, BEFORE safeParse runs.
		const safeParseLines = enc.match(/safeParse\(/g) ?? [];
		expect(safeParseLines.length).toBe(3);

		// List loop: withUserId wraps the normalizeNullToUndefined output.
		expect(enc).toMatch(
			/withUserId\s*\(\s*\n?\s*normalizeNullToUndefined\s*\([\s\S]*?\)\s*,\s*userId\s*\)/
		);
		// Task loop: withUserId wraps normalizeTaskToWire(rawTask).
		expect(enc).toMatch(/withUserId\s*\(\s*this\.normalizeTaskToWire\s*\(\s*rawTask\s*\)\s*,\s*userId\s*\)/);
		// Subtask loop: same wrap.
		expect(enc).toMatch(
			/withUserId\s*\(\s*this\.normalizeSubtaskToWire\s*\(\s*rawSubtask\s*\)\s*,\s*userId\s*\)/
		);
	});
});

/**
 * Regression: an account-key "Encrypted Backup" is readable only on the account
 * that created it. Imported on a different account every field fails the
 * AES-GCM auth check; the old code saved the untouched ciphertext (blank rows,
 * later sync-rejected) with no error. The guard probes one ciphertext per entity
 * kind and, if none decrypt, throws a localized message pointing at the portable
 * (password) backup. This locks the wiring in place. See guideline 44.
 */
describe('reborn-task data-import — cross-account encrypted guard (regression)', () => {
	it('probes decryptability and aborts before the import loops run', () => {
		const src = readSource('./data-import.service.ts');
		const encStart = src.indexOf('private async importEncrypted');
		const encEnd = src.indexOf('private async importDecrypted');
		const enc = src.slice(encStart, encEnd);

		// The guard must run BEFORE any save loop (the first `for` in the method).
		const guardIdx = enc.indexOf('isEncryptedDataReadable');
		const firstLoopIdx = enc.indexOf('for (const list of');
		expect(guardIdx).toBeGreaterThan(-1);
		expect(firstLoopIdx).toBeGreaterThan(guardIdx);

		// Probes a ciphertext from each entity kind, decrypting with the current key.
		expect(enc).toMatch(/lists\[0\]\?\.name_encrypted/);
		expect(enc).toMatch(/tasks\[0\]\?\.title_encrypted/);
		expect(enc).toMatch(/subtasks\[0\]\?\.name_encrypted/);
		expect(enc).toMatch(/cryptoManager\.decryptText/);

		// On failure it throws the localized cross-account message, not a silent skip.
		expect(enc).toMatch(
			/if\s*\(\s*!readable\s*\)\s*\{[\s\S]*?settings\.import_export\.import_cross_account_error/
		);
	});
});
