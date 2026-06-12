/**
 * Locks the web-build guard of the system-bars util: with the compile-time
 * define false (vitest runs the web define), the call must resolve as a
 * no-op without ever touching the Capacitor bridge - that guard is what
 * lets the static `@capacitor/core` import tree-shake out of the web bundle.
 */
import { describe, expect, it, vi } from 'vitest';

const { registerPluginMock } = vi.hoisted(() => ({ registerPluginMock: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: registerPluginMock }));

import { applyNativeStatusBarStyle } from './native-system-bars';

describe('native-system-bars', () => {
  it('no-ops on web builds without touching the plugin bridge', async () => {
    await expect(applyNativeStatusBarStyle()).resolves.toBeUndefined();
    expect(registerPluginMock).not.toHaveBeenCalled();
  });
});
