import { describe, it, expect, vi } from 'vitest';
import {
  runAutoBackup,
  type BackupDestination,
  type RunAutoBackupDeps,
  type AutoBackupState
} from './auto-backup-runner';
import { backupFilename, parseBackupTimestamp, type BackupFile } from './auto-backup';

const APP = 'reborn-notes' as const;
const NOW = Date.parse('2026-06-27T12:00:00.000Z');

class FakeDestination implements BackupDestination {
  files = new Map<string, string>();
  configured = true;
  failList = false;
  failWrite = false;

  async isConfigured(): Promise<boolean> {
    return this.configured;
  }
  async write(name: string, blob: Blob): Promise<void> {
    if (this.failWrite) throw new Error('disk full');
    this.files.set(name, await blob.text());
  }
  async read(name: string): Promise<string> {
    const c = this.files.get(name);
    if (c == null) throw new Error(`not found: ${name}`);
    return c;
  }
  async list(): Promise<BackupFile[]> {
    if (this.failList) throw new Error('list failed');
    return [...this.files.keys()].map((name) => ({
      name,
      at: parseBackupTimestamp(APP, name) ?? '1970-01-01T00:00:00.000Z'
    }));
  }
  async remove(name: string): Promise<void> {
    this.files.delete(name);
  }
  seed(dateIso: string): void {
    this.files.set(backupFilename(APP, dateIso), '{"seeded":true}');
  }
}

function makeDeps(overrides: Partial<RunAutoBackupDeps> = {}): RunAutoBackupDeps & {
  saveState: ReturnType<typeof vi.fn>;
} {
  const state: AutoBackupState = { lastBackupAt: null, lastError: null };
  const saveState = vi.fn(async () => undefined);
  return {
    app: APP,
    config: { enabled: true, intervalHours: 24, retention: { daily: 3, weekly: 0, monthly: 0 } },
    state,
    now: NOW,
    destination: new FakeDestination(),
    getLastDataChangeAt: async () => '2026-06-27T10:00:00.000Z',
    getRecoveryPhrase: async () => 'twelve word phrase here',
    buildBackup: async () => new Blob([JSON.stringify({ version: 3, data: 'x' })]),
    saveState,
    ...overrides
  } as RunAutoBackupDeps & { saveState: ReturnType<typeof vi.fn> };
}

describe('runAutoBackup', () => {
  it('skips when disabled', async () => {
    const deps = makeDeps({ config: { enabled: false, intervalHours: 24, retention: { daily: 3, weekly: 0, monthly: 0 } } });
    expect(await runAutoBackup(deps)).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(deps.saveState).not.toHaveBeenCalled();
  });

  it('skips when no destination is configured', async () => {
    const dest = new FakeDestination();
    dest.configured = false;
    const deps = makeDeps({ destination: dest });
    expect(await runAutoBackup(deps)).toEqual({ status: 'skipped', reason: 'no-destination' });
  });

  it('skips with no-data when there is nothing to back up', async () => {
    const deps = makeDeps({ getLastDataChangeAt: async () => null });
    expect(await runAutoBackup(deps)).toEqual({ status: 'skipped', reason: 'no-data' });
  });

  it('skips with not-due when the interval has not elapsed', async () => {
    const deps = makeDeps({
      state: { lastBackupAt: '2026-06-27T11:00:00.000Z', lastError: null },
      getLastDataChangeAt: async () => '2026-06-27T11:30:00.000Z'
    });
    expect(await runAutoBackup(deps)).toEqual({ status: 'skipped', reason: 'not-due' });
  });

  it('skips when the recovery phrase is unavailable', async () => {
    const deps = makeDeps({ getRecoveryPhrase: async () => null });
    expect(await runAutoBackup(deps)).toEqual({ status: 'skipped', reason: 'no-phrase' });
  });

  it('writes a timestamped backup and records state on the happy path', async () => {
    const dest = new FakeDestination();
    const deps = makeDeps({ destination: dest });
    const result = await runAutoBackup(deps);

    const expectedName = backupFilename(APP, new Date(NOW));
    expect(result).toEqual({ status: 'backed-up', filename: expectedName, removed: [] });
    expect(dest.files.has(expectedName)).toBe(true);
    expect(deps.saveState).toHaveBeenCalledWith({
      lastBackupAt: new Date(NOW).toISOString(),
      lastError: null
    });
  });

  it('runs the self-test and removes a file that fails to verify', async () => {
    const dest = new FakeDestination();
    const verifyBackup = vi.fn(async () => {
      throw new Error('decrypt failed');
    });
    const deps = makeDeps({ destination: dest, verifyBackup });
    const result = await runAutoBackup(deps);

    expect(result.status).toBe('error');
    expect(verifyBackup).toHaveBeenCalledOnce();
    // The corrupt file must not be left behind.
    expect(dest.files.size).toBe(0);
    expect(deps.saveState).toHaveBeenCalledWith({ lastBackupAt: null, lastError: 'decrypt failed' });
  });

  it('reports an error and preserves lastBackupAt when the build throws', async () => {
    const deps = makeDeps({
      state: { lastBackupAt: '2026-06-01T00:00:00.000Z', lastError: null },
      getLastDataChangeAt: async () => '2026-06-27T10:00:00.000Z',
      buildBackup: async () => {
        throw new Error('crypto offline');
      }
    });
    const result = await runAutoBackup(deps);
    expect(result).toEqual({ status: 'error', error: 'crypto offline' });
    expect(deps.saveState).toHaveBeenCalledWith({
      lastBackupAt: '2026-06-01T00:00:00.000Z',
      lastError: 'crypto offline'
    });
  });

  it('rotates out old backups beyond the retention policy', async () => {
    const dest = new FakeDestination();
    // Seed 6 daily backups (yesterday back to 6 days ago).
    for (let d = 1; d <= 6; d++) {
      dest.seed(new Date(NOW - d * 86_400_000).toISOString());
    }
    const deps = makeDeps({
      destination: dest,
      state: { lastBackupAt: new Date(NOW - 86_400_000).toISOString(), lastError: null },
      config: { enabled: true, intervalHours: 24, retention: { daily: 3, weekly: 0, monthly: 0 } }
    });
    const result = await runAutoBackup(deps);

    expect(result.status).toBe('backed-up');
    // 6 seeded + 1 new = 7; keep newest 3 days -> remove 4.
    if (result.status === 'backed-up') expect(result.removed).toHaveLength(4);
    expect(dest.files.size).toBe(3);
  });

  it('still succeeds when rotation listing fails', async () => {
    const dest = new FakeDestination();
    dest.failList = true;
    const deps = makeDeps({ destination: dest });
    const result = await runAutoBackup(deps);
    expect(result.status).toBe('backed-up');
    if (result.status === 'backed-up') expect(result.removed).toEqual([]);
  });
});
