import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: the import summary must render real counts, not raw ICU
 * placeholders. svelte-i18n only interpolates values passed under a `values:`
 * key - an earlier version passed {lists}/{tasks}/{subtasks} as top-level $t
 * options, so the message rendered literally as "{lists} lists, ...". The same
 * results block also carried hardcoded Polish sub-lines (skipped count, error
 * list) that showed Polish to every locale. This locks both fixes via source
 * assertions, with no runtime import of the page's heavy dependency graph.
 * Mirrors `data-import.regression.spec.ts`. See guideline 44.
 */
function readSource(relative: string): string {
	return readFileSync(resolve(__dirname, relative), 'utf-8');
}

const PAGE = '../../routes/settings/import-export/+page.svelte';

describe('reborn-task import summary - i18n interpolation (regression)', () => {
	const page = readSource(PAGE);

	it('passes counts under values: at both import_success call sites', () => {
		// Toast + in-page Alert. A flat `{ lists, tasks, subtasks }` would not
		// interpolate, so each call must nest the counts under `values:`.
		const calls = page.match(/import_export\.import_success'[\s\S]*?values:\s*\{/g) ?? [];
		expect(calls.length).toBe(2);
	});

	it('localizes the skipped-count and error-list lines', () => {
		expect(page).toMatch(/import_export\.import_skipped_note'/);
		expect(page).toMatch(/import_export\.import_errors_title'/);
		expect(page).toMatch(/import_export\.import_errors_more'/);
	});

	it('leaves no hardcoded Polish in the import result block', () => {
		// These literals shipped Polish to all five locales before the fix.
		expect(page).not.toMatch(/Pominięto/);
		expect(page).not.toMatch(/Błędy podczas importu/);
		expect(page).not.toMatch(/} więcej</);
	});
});
