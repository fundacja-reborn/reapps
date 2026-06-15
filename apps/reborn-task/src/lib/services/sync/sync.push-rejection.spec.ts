import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Source-level invariants for permanent push rejections on the task operation
 * queue (guideline 36, rule 14). The sync engine pulls in browser-only modules
 * (IndexedDB, cryptoManager, $env, $app) that are impractical to wire up in
 * Node, so these are source assertions that pin the wiring; the classification
 * logic itself is covered behaviourally in operation-error.spec.ts.
 */
function readSource(relative: string): string {
	return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('task sync - permanent push rejection (sync_error)', () => {
	it('syncOfflineOperations dead-letters a PermanentOperationError: mark entity + drop op + tally', () => {
		const s = readSource('./sync.service.ts');
		const body = s.slice(
			s.indexOf('async syncOfflineOperations'),
			s.indexOf('private async processOperation')
		);
		expect(body).toMatch(/instanceof PermanentOperationError/);
		expect(body).toMatch(/markEntitySyncError/);
		expect(body).toMatch(/removeOperation\(operation\.id\)/);
		expect(body).toMatch(/newSyncErrors\+\+/);
		// Transient path still leaves the op queued as 'failed' (unchanged behaviour).
		expect(body).toMatch(/updateOperationStatus\(\s*[\n\t ]*operation\.id,\s*[\n\t ]*'failed'/);
		// One aggregated toast + a rescan after the batch.
		expect(body).toMatch(/notifyTaskSyncErrors\(newSyncErrors\)/);
		expect(body).toMatch(/refreshSyncErrors\(\)/);
	});

	it('markEntitySyncError writes sync_status sync_error (+ code for tasks)', () => {
		const s = readSource('./sync.service.ts');
		const start = s.indexOf('private async markEntitySyncError');
		expect(start).toBeGreaterThan(-1);
		const body = s.slice(start, start + 1000);
		expect(body).toMatch(/sync_status:\s*'sync_error'/);
		expect(body).toMatch(/sync_error_code:\s*code/);
	});

	it('per-entity sync services assert pushes via ensureOperationOk, not a bare throw', () => {
		for (const f of [
			'./sync-tasks.service.ts',
			'./sync-lists.service.ts',
			'./sync-subtasks.service.ts'
		]) {
			const s = readSource(f);
			expect(s, f).toMatch(/ensureOperationOk\(/);
			// No raw "throw new Error(<x>Response.error ...)" left on the push paths -
			// those discard the status the classifier needs.
			expect(s, f).not.toMatch(/throw new Error\([a-zA-Z]+Response\.error/);
		}
	});

	it('pull guards keep sync_error entities from being overwritten by newer server data', () => {
		expect(readSource('./sync-tasks.service.ts')).toMatch(/sync_status === 'sync_error'/);
		expect(readSource('./sync-lists.service.ts')).toMatch(/sync_status === 'sync_error'/);
		expect(readSource('./sync-subtasks.service.ts')).toMatch(/sync_status === 'sync_error'/);
	});
});
