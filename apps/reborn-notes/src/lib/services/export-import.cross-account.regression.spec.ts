import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: an account-key backup (v1 plaintext envelope, v2 password
 * envelope) is readable only on the account that created it. Imported on a
 * different account every field fails the AES-GCM auth check; the old code
 * saved the untouched ciphertext, which surfaced as unreadable rows (blank
 * titles, default shadow indexes) that then bounced off the server's
 * ownership guard on every push - permanent local garbage plus a sync-reject
 * loop. The guard probes one ciphertext per entity kind and throws a
 * localized message pointing at the portable (password) backup instead.
 *
 * Source-text assertions (no runtime import) keep this independent of the
 * heavy export-import service graph (@reborn/storage, crypto). Mirrors the
 * Task guard regression in `data-import.regression.spec.ts` (#338); this is
 * the Notes port from audit 012 S3.
 */
function read(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('reborn-notes importJsonBackup - cross-account guard (audit 012 S3)', () => {
  const src = read('./export-import.service.ts');
  const start = src.indexOf('export async function importJsonBackup');
  const end = src.indexOf('function stripUnknownNoteShadowIndexes');
  const body = src.slice(start, end);

  it('slices the importJsonBackup body (anchors present, in order)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('probes decryptability before the import loops run', () => {
    expect(start).toBeGreaterThan(-1);
    const guardIdx = body.indexOf('isEncryptedDataReadable');
    const firstLoopIdx = body.indexOf('for (const folder of');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstLoopIdx).toBeGreaterThan(guardIdx);
  });

  it('skips the probe for v3 (portable payload was just re-encrypted with the current key)', () => {
    expect(body).toMatch(/parsed\.version !== 3 && cryptoManager\.isInitialized\(\)/);
  });

  it('probes one ciphertext per entity kind with the current key', () => {
    expect(body).toMatch(/folders\?\.\[0\], 'name_encrypted'/);
    expect(body).toMatch(/notes\?\.\[0\], 'title_encrypted'/);
    expect(body).toMatch(/tags\?\.\[0\], 'name_encrypted'/);
    expect(body).toMatch(/cryptoManager\.decryptText\(ciphertext\)/);
  });

  it('on failure throws the localized cross-account message, not a silent skip', () => {
    // tImportError resolves its key inside settings_page.export_import.* via
    // the dynamically imported i18n store (see the helper's doc comment).
    expect(body).toMatch(
      /if\s*\(\s*!readable\s*\)\s*\{[\s\S]*?tImportError\('import_cross_account_error'\)/
    );
  });
});
