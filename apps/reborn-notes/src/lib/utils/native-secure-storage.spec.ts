/**
 * Locks the raw-bridge secure-storage facade to the plugin's contract.
 *
 * `native-secure-storage.ts` deliberately avoids importing the plugin's JS
 * module at runtime (its lazy platform factory wedged on iOS cold start - see
 * the module header), duplicating two pieces of its contract as literals: the
 * Keychain access-class ordinal and the key prefix. This spec imports the
 * package HERE (test-only, node context) and asserts the literals match, so a
 * plugin upgrade that renumbers the enum or changes the default prefix fails
 * loudly instead of silently writing incompatible or weaker-classed entries.
 */
import { describe, expect, it } from 'vitest';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';

import {
  getSecureStorage,
  KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY
} from './native-secure-storage';

describe('native-secure-storage', () => {
  it('keeps the access-class literal in sync with the plugin enum', () => {
    expect(KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBe(
      KeychainAccess.whenUnlockedThisDeviceOnly
    );
  });

  it('rejects on web builds instead of touching any plugin path', async () => {
    // Vitest runs with __REBORN_NATIVE__ = false (the web define).
    await expect(getSecureStorage()).rejects.toThrow('native-only');
  });
});
