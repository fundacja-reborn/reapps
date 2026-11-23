import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { AutoBackupState } from '@reborn/backup';
import {
  attentionAfterRun,
  attentionFromState,
  backupAttention,
  backupProblem,
  backupProblemText,
  clearBackupAttention,
  showBackupAttention
} from './attention';

const OK: AutoBackupState = { lastBackupAt: '2026-11-22T10:00:00.000Z', lastError: null };
const DENIED: AutoBackupState = {
  lastBackupAt: '2026-11-20T10:00:00.000Z',
  lastError: 'No access to this folder',
  lastErrorCode: 'ACCESS_DENIED'
};

describe('backupProblem', () => {
  it('recognises the folder bridge codes', () => {
    expect(backupProblem('ACCESS_DENIED')).toBe('no-access');
    expect(backupProblem('FOLDER_NOT_FOUND')).toBe('folder-missing');
  });

  it('treats any other failure as a failed backup', () => {
    expect(backupProblem('WRITE_FAILED')).toBe('failed');
    expect(backupProblem(null)).toBe('failed');
    expect(backupProblem(undefined)).toBe('failed');
  });
});

describe('attentionFromState', () => {
  it('shows a saved failure while backup is on', () => {
    expect(attentionFromState(true, DENIED)).toEqual({
      kind: 'failed',
      problem: 'no-access',
      detail: 'No access to this folder'
    });
  });

  it('reads state saved before codes existed as a plain failure', () => {
    expect(attentionFromState(true, { lastBackupAt: null, lastError: 'disk full' })).toEqual({
      kind: 'failed',
      problem: 'failed',
      detail: 'disk full'
    });
  });

  it('shows nothing when backup is off or the last attempt worked', () => {
    expect(attentionFromState(false, DENIED)).toBeNull();
    expect(attentionFromState(true, OK)).toBeNull();
  });
});

describe('attentionAfterRun', () => {
  it('clears the notice after a backup', () => {
    expect(
      attentionAfterRun({ status: 'backed-up', filename: 'f.json', removed: [] }, true, OK)
    ).toBeNull();
  });

  it('explains a failed run by its code', () => {
    expect(
      attentionAfterRun(
        { status: 'error', error: 'The linked folder no longer exists', code: 'FOLDER_NOT_FOUND' },
        true,
        DENIED
      )
    ).toEqual({
      kind: 'failed',
      problem: 'folder-missing',
      detail: 'The linked folder no longer exists'
    });
  });

  it('asks for the recovery phrase when the device has none', () => {
    expect(attentionAfterRun({ status: 'skipped', reason: 'no-phrase' }, true, OK)).toEqual({
      kind: 'no-phrase'
    });
  });

  it('keeps a failure that a later run did not retry', () => {
    expect(attentionAfterRun({ status: 'skipped', reason: 'not-due' }, true, DENIED)).toEqual(
      attentionFromState(true, DENIED)
    );
    expect(attentionAfterRun({ status: 'skipped', reason: 'not-due' }, true, OK)).toBeNull();
  });

  it('keeps what is shown when the run could not judge', () => {
    expect(
      attentionAfterRun({ status: 'skipped', reason: 'locked' }, true, DENIED)
    ).toBeUndefined();
  });

  it('shows nothing when there is nothing to back up or backup is off', () => {
    for (const reason of ['disabled', 'no-destination', 'no-data'] as const) {
      expect(attentionAfterRun({ status: 'skipped', reason }, true, DENIED)).toBeNull();
    }
    expect(
      attentionAfterRun({ status: 'error', error: 'x', code: null }, false, DENIED)
    ).toBeNull();
  });
});

describe('backupProblemText', () => {
  const translate = (id: string) => `T(${id})`;

  it('explains the recognised problems in the app language', () => {
    expect(backupProblemText('no-access', 'raw', translate)).toBe('T(backup_attention.no_access)');
    expect(backupProblemText('folder-missing', 'raw', translate)).toBe(
      'T(backup_attention.folder_missing)'
    );
  });

  it('shows the raw reason of any other failure', () => {
    expect(backupProblemText('failed', 'Disk full', translate)).toBe('Disk full');
  });
});

describe('backupAttention store', () => {
  it('keeps the notice on undefined and hides it on clear', () => {
    showBackupAttention({ kind: 'no-phrase' });
    showBackupAttention(undefined);
    expect(get(backupAttention)).toEqual({ kind: 'no-phrase' });
    clearBackupAttention();
    expect(get(backupAttention)).toBeNull();
  });
});
