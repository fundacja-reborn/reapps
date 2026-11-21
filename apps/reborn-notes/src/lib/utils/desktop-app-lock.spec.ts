/**
 * Locks the desktop App Lock facade to the shell's command contract
 * (`src-tauri/src/app_lock.rs`): command names, argument keys and the error
 * shape are plain strings on both sides, so a rename on one side only would
 * surface as an App Lock that never unlocks, not as a build error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDesktopBiometryStatus, promptDesktopAuth } from './desktop-app-lock';
import { isShellDialogOpen, onShellDialogClosed } from './desktop-bridge';

describe('desktop-app-lock', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => null);
    globals.__TAURI__ = { core: { invoke } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  describe('getDesktopBiometryStatus', () => {
    it('passes a Touch ID status through', async () => {
      invoke.mockResolvedValueOnce({ isAvailable: true, deviceIsSecure: true, kind: 'touchId' });

      await expect(getDesktopBiometryStatus()).resolves.toEqual({
        isAvailable: true,
        deviceIsSecure: true,
        kind: 'touchId'
      });
      expect(invoke).toHaveBeenCalledWith('app_lock_status', undefined);
    });

    it('treats a Mac without Touch ID as password-only, still lockable', async () => {
      invoke.mockResolvedValueOnce({ isAvailable: false, deviceIsSecure: true, kind: 'none' });

      await expect(getDesktopBiometryStatus()).resolves.toEqual({
        isAvailable: false,
        deviceIsSecure: true,
        kind: 'none'
      });
    });

    it('reports nothing available when the shell cannot answer', async () => {
      invoke.mockRejectedValueOnce('unknown command');

      await expect(getDesktopBiometryStatus()).resolves.toEqual({
        isAvailable: false,
        deviceIsSecure: false,
        kind: 'none'
      });
    });

    it('never labels an unknown biometry kind', async () => {
      invoke.mockResolvedValueOnce({ isAvailable: true, deviceIsSecure: true, kind: 'opticId' });

      const status = await getDesktopBiometryStatus();

      expect(status.kind).toBe('none');
    });
  });

  describe('promptDesktopAuth', () => {
    it('sends both prompt texts and resolves ok', async () => {
      await expect(
        promptDesktopAuth({ reason: 'Unlock re/notes', macosReason: 'unlock your notes' })
      ).resolves.toEqual({ ok: true });

      expect(invoke).toHaveBeenCalledWith('app_lock_authenticate', {
        reason: 'Unlock re/notes',
        macosReason: 'unlock your notes'
      });
    });

    it('sends null when there is no macOS text, so the shell falls back', async () => {
      await promptDesktopAuth({ reason: 'Unlock re/notes' });

      expect(invoke).toHaveBeenCalledWith('app_lock_authenticate', {
        reason: 'Unlock re/notes',
        macosReason: null
      });
    });

    it('hands the shell error code to the caller (cancel is not an error)', async () => {
      invoke.mockRejectedValueOnce({ code: 'userCancel' });

      await expect(promptDesktopAuth({ reason: 'x' })).resolves.toEqual({
        ok: false,
        code: 'userCancel'
      });
    });

    it('maps an unexpected rejection to a generic failure', async () => {
      invoke.mockRejectedValueOnce(new Error('bridge gone'));

      await expect(promptDesktopAuth({ reason: 'x' })).resolves.toEqual({
        ok: false,
        code: 'authenticationFailed'
      });
    });

    it('marks the prompt as a system dialog while it is open', async () => {
      let openDuringPrompt = false;
      invoke.mockImplementationOnce(async () => {
        openDuringPrompt = isShellDialogOpen();
        return null;
      });
      const closed = vi.fn();
      const off = onShellDialogClosed(closed);

      await promptDesktopAuth({ reason: 'x' });
      off();

      expect(openDuringPrompt).toBe(true);
      expect(isShellDialogOpen()).toBe(false);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('closes the dialog bookkeeping on failure too', async () => {
      invoke.mockRejectedValueOnce({ code: 'userCancel' });

      await promptDesktopAuth({ reason: 'x' });

      expect(isShellDialogOpen()).toBe(false);
    });
  });
});
