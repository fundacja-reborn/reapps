/**
 * Locks the raw-bridge secure-storage facade to the plugin's contract.
 *
 * `secure-storage.ts` deliberately avoids importing the plugin's JS module at
 * runtime (its lazy platform factory wedged on iOS cold start - see the module
 * header), duplicating two pieces of its contract as literals: the Keychain
 * access-class ordinal and the key prefix. This spec imports the package HERE
 * (test-only, node context) and asserts the literals match, so a plugin
 * upgrade that renumbers the enum or changes the default prefix fails loudly
 * instead of silently writing incompatible or weaker-classed entries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';

const calls: Array<{ method: string; options: Record<string, unknown> }> = [];

vi.mock('@capacitor/core', () => ({
  registerPlugin: () =>
    new Proxy(
      {},
      {
        get:
          (_target, method: string) =>
          async (options: Record<string, unknown>) => {
            calls.push({ method, options });
            return method === 'internalGetItem' ? { data: 'stored' } : undefined;
          }
      }
    )
}));

import {
  createCapacitorSecureStorage,
  KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY
} from './secure-storage';

describe('capacitor secure storage', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('keeps the access-class literal in sync with the plugin enum', () => {
    expect(KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBe(
      KeychainAccess.whenUnlockedThisDeviceOnly
    );
  });

  it('writes with the JS-layer key prefix, no sync and the this-device-only class', async () => {
    await createCapacitorSecureStorage().setItem('refresh_token', 'tok');
    expect(calls).toEqual([
      {
        method: 'internalSetItem',
        options: {
          prefixedKey: 'capacitor-storage_refresh_token',
          data: 'tok',
          sync: false,
          access: KeychainAccess.whenUnlockedThisDeviceOnly
        }
      }
    ]);
  });

  it('reads and removes through the same prefixed key', async () => {
    const storage = createCapacitorSecureStorage();
    await expect(storage.getItem('master_key')).resolves.toBe('stored');
    await storage.removeItem('master_key');
    expect(calls.map((c) => [c.method, c.options.prefixedKey, c.options.sync])).toEqual([
      ['internalGetItem', 'capacitor-storage_master_key', false],
      ['internalRemoveItem', 'capacitor-storage_master_key', false]
    ]);
  });
});
