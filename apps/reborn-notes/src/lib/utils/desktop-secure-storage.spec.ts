/**
 * Locks the desktop secure-storage facade to the shell's command contract
 * (`src-tauri/src/secure_storage.rs`): command names and argument keys are
 * plain strings on both sides, so a rename on one side only would surface as
 * a lost session at runtime, not as a build error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDesktopSecureStorage } from './desktop-secure-storage';

describe('desktop-secure-storage', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => null);
    globals.__TAURI__ = { core: { invoke } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  it('writes through secure_storage_set', async () => {
    await getDesktopSecureStorage().setItem('refresh_token', 'value-1');

    expect(invoke).toHaveBeenCalledWith('secure_storage_set', {
      key: 'refresh_token',
      value: 'value-1'
    });
  });

  it('reads through secure_storage_get', async () => {
    invoke.mockResolvedValueOnce('value-2');

    await expect(getDesktopSecureStorage().getItem('master_key')).resolves.toBe('value-2');
    expect(invoke).toHaveBeenCalledWith('secure_storage_get', { key: 'master_key' });
  });

  it('reports a missing entry as null', async () => {
    invoke.mockResolvedValueOnce(null);

    await expect(getDesktopSecureStorage().getItem('master_key')).resolves.toBeNull();
  });

  it('removes through secure_storage_remove', async () => {
    await getDesktopSecureStorage().removeItem('refresh_token');

    expect(invoke).toHaveBeenCalledWith('secure_storage_remove', { key: 'refresh_token' });
  });

  it('rejects when the shell bridge is missing, so callers take their degrade path', async () => {
    delete globals.__TAURI__;

    await expect(getDesktopSecureStorage().getItem('master_key')).rejects.toThrow(
      'desktop bridge unavailable'
    );
  });
});
