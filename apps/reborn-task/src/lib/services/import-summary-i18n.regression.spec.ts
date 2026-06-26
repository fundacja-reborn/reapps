import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: the import summary must render real counts, not raw ICU
 * placeholders. svelte-i18n only interpolates values passed under a `values:`
 * key - an earlier version passed {lists}/{tasks}/{subtasks} as top-level $t
 * options, so the message rendered literally as "{lists} lists, ...". The same
 * results block also carried hardcoded Polish sub-lines (skipped count, error
 * list) that showed Polish to every locale. The decrypted-export warning block
 * (title, body, "export anyway"/"cancel" buttons) plus the export and import
 * button loading labels (each a `{$t('common.loading') || 'Polish...'}` fallback)
 * had the same problem. The bare file `<input>` was a third leak: it rendered
 * browser-locale chrome ("Wybierz plik"), now hidden behind a localized button.
 * This locks all of those via source assertions, with no runtime import of the
 * page's heavy dependency graph. Mirrors `data-import.regression.spec.ts`. See
 * guideline 44.
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

describe('reborn-task export & import action labels - i18n (regression)', () => {
	const page = readSource(PAGE);

	it('localizes the decrypted-export warning text and buttons', () => {
		expect(page).toMatch(/import_export\.export_decrypted_warning_title'/);
		expect(page).toMatch(/import_export\.export_decrypted_warning_body'/);
		expect(page).toMatch(/import_export\.export_anyway_button'/);
	});

	it('localizes the export and import loading labels', () => {
		expect(page).toMatch(/import_export\.exporting'/);
		expect(page).toMatch(/import_export\.importing'/);
	});

	it('hides the native file input behind a localized picker button', () => {
		// A bare <input type="file"> renders browser-locale chrome ("Wybierz plik"
		// / "Nie wybrano pliku"); hide it (sr-only) and drive selection from a
		// localized Button + filename label instead, so no Polish leaks via the OS.
		expect(page).toMatch(/type="file"[\s\S]{0,200}?class="sr-only"/);
		expect(page).toMatch(/import_export\.import_select_file'/);
		expect(page).toMatch(/import_export\.import_no_file'/);
		expect(page).not.toMatch(/file:bg-background/); // old native-button styling
	});

	it('drops every hardcoded `|| Polish` fallback on loading labels', () => {
		// Was `{$t('common.loading') || 'Eksportowanie...'}` (and ...Importowanie...) -
		// the `|| 'Polish'` fallback shipped Polish to every locale; now dedicated
		// exporting/importing keys are used with no fallback.
		expect(page).not.toMatch(/common\.loading'\)\s*\|\|/);
	});

	it('leaves no hardcoded Polish in the export/import action labels', () => {
		expect(page).not.toMatch(/Eksportowanie/);
		expect(page).not.toMatch(/Importowanie/);
		expect(page).not.toMatch(/Eksportuj mimo to/);
		expect(page).not.toMatch(/Uwaga: dane zostaną/);
		expect(page).not.toMatch(/Anuluj/);
	});
});
