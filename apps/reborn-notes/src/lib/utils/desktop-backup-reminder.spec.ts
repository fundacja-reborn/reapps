/**
 * Locks the desktop reminder facade to the shell's command contract
 * (`src-tauri/src/backup_reminder.rs`): command names, argument keys and the
 * permission words are plain strings on both sides, so a rename on one side
 * only would surface as reminders that silently never come.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelDesktopReminders,
  getDesktopReminderPermission,
  requestDesktopReminderPermission,
  scheduleDesktopReminders
} from './desktop-backup-reminder';
import { isShellDialogOpen } from './desktop-bridge';

describe('desktop-backup-reminder', () => {
  const globals = globalThis as { __TAURI__?: unknown };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async () => null);
    globals.__TAURI__ = { core: { invoke } };
  });

  afterEach(() => {
    delete globals.__TAURI__;
  });

  it('reads the permission words the shell sends', async () => {
    for (const word of ['granted', 'denied', 'prompt', 'unsupported']) {
      invoke.mockResolvedValueOnce(word);
      await expect(getDesktopReminderPermission()).resolves.toBe(word);
    }
    expect(invoke).toHaveBeenCalledWith('backup_reminder_status', undefined);
  });

  it('treats an unknown answer, a failure or a missing bridge as unsupported', async () => {
    invoke.mockResolvedValueOnce('maybe');
    await expect(getDesktopReminderPermission()).resolves.toBe('unsupported');

    invoke.mockRejectedValueOnce(new Error('ipc down'));
    await expect(getDesktopReminderPermission()).resolves.toBe('unsupported');

    delete globals.__TAURI__;
    await expect(getDesktopReminderPermission()).resolves.toBe('unsupported');
    await expect(requestDesktopReminderPermission()).resolves.toBe('unsupported');
  });

  it('asks for the permission as a shell dialog', async () => {
    let openDuringCall = false;
    invoke.mockImplementationOnce(async () => {
      openDuringCall = isShellDialogOpen();
      return 'granted';
    });

    await expect(requestDesktopReminderPermission()).resolves.toBe('granted');
    expect(invoke).toHaveBeenCalledWith('backup_reminder_request_permission', undefined);
    expect(openDuringCall).toBe(true);
    expect(isShellDialogOpen()).toBe(false);
  });

  it('sends the times and the copy under the argument names the command takes', async () => {
    await scheduleDesktopReminders([1, 2], 'Title', 'Body');
    expect(invoke).toHaveBeenCalledWith('backup_reminder_schedule', {
      at: [1, 2],
      title: 'Title',
      body: 'Body'
    });
  });

  it('passes a scheduling rejection on to the caller', async () => {
    invoke.mockRejectedValueOnce({ code: 'invalidRequest' });
    await expect(scheduleDesktopReminders([1], 'T', 'B')).rejects.toEqual({
      code: 'invalidRequest'
    });
  });

  it('cancels without ever rejecting', async () => {
    await cancelDesktopReminders();
    expect(invoke).toHaveBeenCalledWith('backup_reminder_cancel', undefined);

    invoke.mockRejectedValueOnce(new Error('ipc down'));
    await expect(cancelDesktopReminders()).resolves.toBeUndefined();
  });
});
