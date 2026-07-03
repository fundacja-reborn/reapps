import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Source-level invariants for the cross-key push guard (audit 012 S6).
 *
 * Scenario: notes created in local-only mode (all pending), then the user logs
 * into an EXISTING account in the peer Task app. Task swaps the shared-origin
 * master key to the account key and wipes only its own DB - Notes still holds
 * pending ciphertexts under the abandoned local key. Without the guard the
 * next `pushPendingItems()` uploaded them: valid `iv:ciphertext` format, wrong
 * key - permanently unreadable records on the account, visible on every
 * device. The reverse direction (Task data + login in Notes) was already
 * covered by Task's `recoverFromKeyMismatch()`; this is the Notes side.
 *
 * Like notes-sync.regression.spec.ts these are source assertions - the sync
 * service pulls in browser-only modules (IndexedDB, cryptoManager, $env) that
 * are impractical to wire up in Node. The probe logic itself is unit-tested in
 * @reborn/crypto (decrypt-probe.spec.ts).
 */
function read(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('notes-sync - cross-key pending guard (audit 012 S6)', () => {
  const src = read('./notes-sync.service.ts');
  const start = src.indexOf('export async function pushPendingItems');
  const body = src.slice(start, src.indexOf('async function retryWithBackoff'));

  it('probes pending rows with the current key before any push fires', () => {
    expect(start).toBeGreaterThan(-1);
    const probeIdx = body.indexOf('isEncryptedDataReadable');
    // Folders push first - the probe must come before that.
    const firstPushIdx = body.indexOf('buildFolderLayers');
    expect(probeIdx).toBeGreaterThan(-1);
    expect(firstPushIdx).toBeGreaterThan(probeIdx);
  });

  it('never runs the probe without a loaded master key (audit 013 S1)', () => {
    // The probe cannot tell "wrong key" from "no key in memory" - decryptText
    // rejects either way. The offline→online handler calls pushPendingItems()
    // on every route, including /auth/unlock: a fresh tab opened offline with
    // unsynced edits would probe all-fail once connectivity returned and the
    // online branch wiped those edits before they ever reached the server.
    // The gate must be an early return that precedes the probe.
    const gateIdx = body.indexOf('if (!cryptoManager.isInitialized()) return;');
    const probeIdx = body.indexOf('isEncryptedDataReadable');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(probeIdx);
  });

  it('probes one ciphertext per pending entity kind', () => {
    expect(body).toMatch(/pendingNotes\[0\] \?\? pendingArchivedNotes\[0\]/);
    expect(body).toMatch(/pendingFolders\[0\]\?\.name_encrypted/);
    expect(body).toMatch(/pendingTags\[0\]\?\.name_encrypted/);
    expect(body).toMatch(/pendingSavedSearches\[0\]\?\.name_encrypted/);
  });

  it('on mismatch wipes local data + delta watermark and resets the in-memory view', () => {
    expect(body).toMatch(/await clearAllUserData\(\)/);
    expect(body).toMatch(/clearNotesDeltaWatermark\(\)/);
    expect(body).toMatch(/noteIndex\.clear\(\)/);
    expect(body).toMatch(/notesStore\.refresh\(\)/);
  });

  it('offline: skips the push WITHOUT wiping (a wipe without a pull would destroy the only copy)', () => {
    const offlineIdx = body.indexOf('navigator.onLine');
    const wipeIdx = body.indexOf('await clearAllUserData()');
    expect(offlineIdx).toBeGreaterThan(-1);
    expect(offlineIdx).toBeLessThan(wipeIdx);
    // The offline branch returns before the wipe runs.
    const offlineBranch = body.slice(offlineIdx, wipeIdx);
    expect(offlineBranch).toMatch(/return;/);
  });
});
