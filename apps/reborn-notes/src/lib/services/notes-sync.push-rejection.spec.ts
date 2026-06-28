import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Source-level invariants for permanent push rejections (guideline 36, rule 14).
 *
 * Like notes-sync.regression.spec.ts, these are source assertions: the sync
 * service pulls in browser-only modules (IndexedDB, cryptoManager, $env) that
 * are impractical to wire up in Node. The behavioural classification logic is
 * covered separately in push-error.spec.ts. These checks pin the wiring that
 * keeps a 4xx-rejected note from re-pushing forever.
 */
function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

const src = () => readSource('./notes-sync.service.ts');

describe('notes-sync - permanent push rejection (sync_error)', () => {
  it('retryWithBackoff short-circuits on a permanent HttpPushError (no retry rounds)', () => {
    const s = src();
    const body = s.slice(
      s.indexOf('async function retryWithBackoff'),
      s.indexOf('async function pushSilently')
    );
    expect(body).toMatch(/instanceof HttpPushError/);
    // The permanent branch throws before the maxRetries / backoff logic.
    const throwIdx = body.indexOf('instanceof HttpPushError');
    const backoffIdx = body.indexOf('attempt === maxRetries');
    expect(throwIdx).toBeGreaterThan(-1);
    expect(backoffIdx).toBeGreaterThan(throwIdx);
  });

  it('pushSilently routes permanent failures to onPermanentFailure, transient to retry log', () => {
    const s = src();
    const body = s.slice(s.indexOf('async function pushSilently'), s.indexOf('const entityChains'));
    expect(body).toMatch(/onPermanentFailure/);
    expect(body).toMatch(/instanceof HttpPushError/);
    // Transient branch still reports network failures + logs for the periodic retry.
    expect(body).toMatch(/reportSyncError/);
  });

  it('markNoteSyncError writes sync_status sync_error + sync_error_code', () => {
    const s = src();
    const start = s.indexOf('async function markNoteSyncError');
    expect(start).toBeGreaterThan(-1);
    const body = s.slice(start, start + 400);
    expect(body).toMatch(/sync_status:\s*'sync_error'/);
    expect(body).toMatch(/sync_error_code:\s*code/);
  });

  it('note POST/PATCH paths assert via ensureOk and mark sync_error on permanent failure', () => {
    const s = src();
    for (const sig of ['export function pushNote\\b', 'export function pushNoteUpdate\\b']) {
      const start = s.search(new RegExp(sig));
      expect(start, sig).toBeGreaterThan(-1);
      const body = s.slice(start, start + 2100);
      expect(body, `${sig} must assert via ensureOk`).toMatch(/ensureOk\(/);
      expect(body, `${sig} must mark sync_error on permanent failure`).toMatch(/markNoteSyncError/);
      expect(body, `${sig} must clear sync_error_code on success`).toMatch(
        /sync_error_code:\s*undefined/
      );
    }
  });

  it('note DELETE/restore paths assert via ensureOk and mark sync_error on permanent failure', () => {
    const s = src();
    // Bound each function body to the next export so the assertion cannot borrow
    // a neighbour's ensureOk / markNoteSyncError.
    const bodyOf = (sig: string): string => {
      const start = s.search(new RegExp(sig));
      expect(start, sig).toBeGreaterThan(-1);
      const rest = s.slice(start + 1);
      const next = rest.search(/\nexport (?:async )?function /);
      return next > -1 ? rest.slice(0, next) : rest;
    };
    for (const sig of ['export function pushNoteDelete\\b', 'export function pushNoteRestore\\b']) {
      const body = bodyOf(sig);
      expect(body, `${sig} must assert via ensureOk`).toMatch(/ensureOk\(/);
      expect(body, `${sig} must mark sync_error on permanent failure`).toMatch(/markNoteSyncError/);
      // Guard the old bare-throw from regressing: `if (!res.ok) throw new Error`
      // left the note 'pending' and re-pushed the doomed request on every
      // periodic sync - the native CSRF-403 delete loop (smoke 2026-06-28).
      expect(body, `${sig} must not bare-throw on !res.ok`).not.toMatch(
        /if \(!res\.ok\) throw new Error/
      );
    }
  });

  it('pushPendingItems batch tallies new sync_errors and raises one aggregated toast', () => {
    const s = src();
    const body = s.slice(
      s.indexOf('Then push notes (POST for creates/updates)'),
      s.indexOf('Retry archived-pending notes')
    );
    expect(body).toMatch(/ensureOk\(/);
    expect(body).toMatch(/markNoteSyncError/);
    expect(body).toMatch(/newNoteSyncErrors\+\+/);
    expect(body).toMatch(/notifyBatchSyncErrors\(newNoteSyncErrors\)/);
  });

  it('pull guard keeps sync_error notes from being overwritten by a newer server version', () => {
    const s = src();
    expect(s).toMatch(
      /localNote\.sync_status === 'pending' \|\| localNote\.sync_status === 'sync_error'/
    );
  });
});
