/**
 * Locks the wipe-path ordering in `clearAutoBackupState`: the folder bookmark
 * must be captured BEFORE `clearAutoBackupPrefs()` removes the config entry
 * (the SAF tree Uri is unrecoverable afterwards, so a late read would leak the
 * persisted WRITE grant in the OS forever), and the release must echo the
 * `write: true` mode the folder was picked with.
 *
 * Source-level assertions (same pattern as `notes-sync.regression.spec.ts`):
 * `__REBORN_NATIVE__` is a compile-time define (false under vitest), so the
 * native branch cannot be exercised at runtime here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, './index.ts'), 'utf-8');
const fn = src.slice(src.indexOf('export async function clearAutoBackupState'));

describe('clearAutoBackupState wipe path (source-level)', () => {
  it('captures the folder bookmark before the prefs wipe removes it', () => {
    const bookmarkRead = fn.indexOf('loadAutoBackupConfig().folderBookmark');
    const prefsWipe = fn.indexOf('clearAutoBackupPrefs()');
    expect(bookmarkRead).toBeGreaterThan(-1);
    expect(prefsWipe).toBeGreaterThan(-1);
    expect(bookmarkRead).toBeLessThan(prefsWipe);
  });

  it('releases the persisted SAF grant with the WRITE mode it was taken with', () => {
    expect(fn).toMatch(/releaseDirectory\(\{ bookmark: folderBookmark, write: true \}\)/);
  });

  it('runs the release before the vault wipe, in its own try/catch', () => {
    const releaseIdx = fn.indexOf('releaseDirectory');
    const vaultIdx = fn.indexOf('clearRecoveryPhrase');
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(vaultIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeLessThan(vaultIdx);
    // A failed release must not block the recovery-phrase wipe that follows.
    expect(fn.slice(releaseIdx, vaultIdx)).toContain('catch');
  });
});
