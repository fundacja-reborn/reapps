import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression (2026-11-28, first Play build of re/task): the Android shell read
 * every GET body as empty, and syncLists() treated "success, no data" as "the
 * account has no lists" - one new default list on the server per sync, and no
 * tasks on the device. The transport is fixed in @reborn/api-client
 * (parse-response.spec.ts); these source assertions pin the second line of
 * defence in the list pull. Source-level for the same reason as
 * sync.push-rejection.spec.ts: the sync engine needs IndexedDB, cryptoManager
 * and $app modules that are impractical to wire up in Node.
 */
function syncListsBody(): string {
	const s = readFileSync(resolve(__dirname, './sync-lists.service.ts'), 'utf-8');
	const start = s.indexOf('async syncLists()');
	const end = s.indexOf('private async createDefaultList');
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return s.slice(start, end);
}

describe('task sync - list pull never invents a default list from a missing answer', () => {
	it('requires a real array before reading the lists', () => {
		const body = syncListsBody();
		const guard = body.indexOf('!Array.isArray(response.data)');
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(body.indexOf('this.createDefaultList()'));
		// The old coercion turned "no data" into "zero lists".
		expect(body).not.toMatch(/response\.data\s*\|\|\s*\[\]/);
	});

	it('does not add a default list while this device already holds one', () => {
		const body = syncListsBody();
		const localCheck = body.indexOf('listStore.getAll()');
		expect(localCheck).toBeGreaterThan(-1);
		expect(localCheck).toBeLessThan(body.indexOf('this.createDefaultList()'));
	});
});
