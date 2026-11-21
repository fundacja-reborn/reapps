/**
 * Locks the desktop version facade to the shell's `app_info` command
 * (`src-tauri/src/app_info.rs`): the command name and the field names are
 * plain strings on both sides, so a rename on one side only would show up as
 * a Settings screen without the app version, not as a build error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDesktopAppInfo, parseDesktopAppInfo } from './desktop-app-info';

describe('parseDesktopAppInfo', () => {
  it('reads version, build and a known desktop platform', () => {
    expect(parseDesktopAppInfo({ version: '0.1.0', build: '1', platform: 'macos' })).toEqual({
      version: '0.1.0',
      build: '1',
      platform: 'macos'
    });
    expect(parseDesktopAppInfo({ version: '1.2.0', build: '12', platform: 'windows' })).toEqual({
      version: '1.2.0',
      build: '12',
      platform: 'windows'
    });
  });

  it('keeps the version but drops a platform release notes do not know', () => {
    expect(parseDesktopAppInfo({ version: '0.1.0', build: '1', platform: 'freebsd' })).toEqual({
      version: '0.1.0',
      build: '1',
      platform: null
    });
    // Mobile and web names are not desktop systems.
    expect(parseDesktopAppInfo({ version: '0.1.0', build: '1', platform: 'web' })?.platform).toBe(
      null
    );
  });

  it('rejects an answer without a version or build', () => {
    expect(parseDesktopAppInfo(null)).toBeNull();
    expect(parseDesktopAppInfo('0.1.0')).toBeNull();
    expect(parseDesktopAppInfo({ build: '1', platform: 'macos' })).toBeNull();
    expect(parseDesktopAppInfo({ version: '0.1.0', platform: 'macos' })).toBeNull();
    expect(parseDesktopAppInfo({ version: ' ', build: '1', platform: 'macos' })).toBeNull();
    expect(parseDesktopAppInfo({ version: '0.1.0', build: 1, platform: 'macos' })).toBeNull();
  });
});

describe('getDesktopAppInfo', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => ({ version: '0.1.0', build: '1', platform: 'macos' }));
    globals.__TAURI__ = { core: { invoke } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  it('asks the shell through the app_info command', async () => {
    await expect(getDesktopAppInfo()).resolves.toEqual({
      version: '0.1.0',
      build: '1',
      platform: 'macos'
    });
    expect(invoke).toHaveBeenCalledWith('app_info', undefined);
  });

  it('resolves null when the shell cannot answer', async () => {
    invoke.mockRejectedValueOnce('unknown command');
    await expect(getDesktopAppInfo()).resolves.toBeNull();
  });

  it('resolves null outside the shell', async () => {
    delete globals.__TAURI__;
    await expect(getDesktopAppInfo()).resolves.toBeNull();
  });
});
