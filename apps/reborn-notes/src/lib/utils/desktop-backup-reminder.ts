/**
 * Overdue-backup reminder for the desktop (Tauri) shell, behind the shell's
 * `backup_reminder_*` commands (`src-tauri/src/backup_reminder.rs`).
 *
 * The phones plan the same reminder through `@capacitor/local-notifications`;
 * `$lib/services/auto-backup/reminder.ts` picks this module on desktop builds.
 * The system delivers the reminder even when the app is closed (macOS:
 * `UNUserNotificationCenter`). The shell owns the identifiers, so the page can
 * only replace or cancel these reminders, never any other notification.
 *
 * `unsupported`: no notification center for this build - the bare binary of
 * `cargo tauri dev` (not an app bundle), and Windows until its phase.
 *
 * Desktop-only: every caller sits behind `__REBORN_DESKTOP__`.
 */

import { invokeDesktop, invokeDesktopDialog } from './desktop-bridge';

/** The notification permission as the shell reports it. */
export type ReminderPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

const PERMISSIONS: readonly ReminderPermission[] = ['granted', 'denied', 'prompt', 'unsupported'];

function toPermission(value: unknown): ReminderPermission {
  return PERMISSIONS.includes(value as ReminderPermission)
    ? (value as ReminderPermission)
    : 'unsupported';
}

/** The current permission. Never rejects. */
export async function getDesktopReminderPermission(): Promise<ReminderPermission> {
  try {
    return toPermission(await invokeDesktop<unknown>('backup_reminder_status'));
  } catch {
    return 'unsupported';
  }
}

/**
 * Ask for the permission if it was never asked, then report it. Never rejects.
 *
 * Counted as a shell dialog: the system prompt may take the focus, which must
 * not read as "left the app" to App Lock (see `invokeDesktopDialog`).
 */
export async function requestDesktopReminderPermission(): Promise<ReminderPermission> {
  try {
    return toPermission(await invokeDesktopDialog<unknown>('backup_reminder_request_permission'));
  } catch {
    return 'unsupported';
  }
}

/**
 * Replace the pending reminders: `at` in epoch ms (at most two), the same
 * static copy for each. Rejects with the shell's `{ code }` on a bad request.
 */
export async function scheduleDesktopReminders(
  at: number[],
  title: string,
  body: string
): Promise<void> {
  await invokeDesktop<null>('backup_reminder_schedule', { at, title, body });
}

/** Drop the pending reminders. Never rejects. */
export async function cancelDesktopReminders(): Promise<void> {
  try {
    await invokeDesktop<null>('backup_reminder_cancel');
  } catch {
    // Nothing pending can outlive a shell that cannot answer.
  }
}
