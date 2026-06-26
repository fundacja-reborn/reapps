import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: a portable (version 3) import regenerates every id, so re-running
 * it ADDS fresh copies instead of updating in place. The import-export page
 * warns the user about this - but the warning must show ONLY for portable
 * backups. A version 2 (legacy, same-account) backup keeps ids and upserts, so
 * a re-import there does NOT duplicate and the note would be misleading.
 *
 * Source-text assertions (no runtime import) keep this independent of the heavy
 * export-import service graph (@reborn/storage, crypto). They lock both the v3
 * detector and the gate wiring so the note cannot silently start showing for v2
 * (or stop showing for v3). Mirrors reborn-task `data-import.regression.spec.ts`.
 */
function read(relative: string): string {
	return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('reborn-notes portable-backup detection (regression)', () => {
	it('isPortableBackup matches version 3 only', () => {
		const src = read('./export-import.service.ts');
		expect(src).toMatch(/export function isPortableBackup\(raw: string\): boolean/);
		// v3 is the portable, cross-account, id-regenerating format.
		expect(src).toMatch(/JSON\.parse\(raw\)\.version === 3/);
	});
});

describe('reborn-notes import-export page (regression)', () => {
	const page = read('../../routes/settings/import-export/+page.svelte');

	it('imports the v3 detector', () => {
		expect(page).toMatch(/isPortableBackup/);
	});

	it('flags portable backups from the selected file', () => {
		expect(page).toMatch(/backupIsPortable = isPortableBackup\(raw\)/);
	});

	it('shows the additive-copy note only when the backup is portable', () => {
		// Gated on backupIsPortable so it never renders for a v2 (same-account,
		// upsert) backup, where a re-import does not create duplicates.
		expect(page).toMatch(
			/\{#if backupIsPortable\}[\s\S]*?import_portable_additive_note[\s\S]*?\{\/if\}/
		);
	});
});
