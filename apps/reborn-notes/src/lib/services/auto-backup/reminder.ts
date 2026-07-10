/**
 * Overdue-backup reminder: a local notification nudging the user to open the
 * app when an automatic backup could not run for too long. Backups execute
 * only on app open/resume (guideline 71 - true background execution is not
 * viable in a Capacitor WebView), so a user who stops opening the app silently
 * stops getting backups; this is the mitigation, same pattern Proton Drive
 * uses on iOS (a scheduled "open the app" notification, not background work).
 *
 * Mechanics: after every backup run (and every toggle change) the pending
 * reminders are re-planned - one nudge ~2h past the due point and a second
 * one ~a week later for long absences. A reminder is only planned while
 * there is actually something unbacked (`lastDataChangeAt` newer than
 * `lastBackupAt`): the skip-if-unchanged gate freezes `lastBackupAt` for a
 * user who merely READS notes, and nagging them to open an app that would
 * then do nothing is noise. Any future data change necessarily happens with
 * the app open, which reruns the backup and re-plans - so no reminder is
 * ever missed by cancelling here.
 *
 * Zero-Knowledge: the notification carries only static localized copy -
 * never note data, filenames or timestamps derived from content.
 *
 * Best-effort by design: requires OS notification permission (requested from
 * the settings page when enabling); on Android 12+ exact alarms are NOT
 * requested - the plugin transparently falls back to inexact scheduling,
 * which is plenty for a "sometime after it became overdue" nudge.
 */

import { createLogger } from '@reborn/utils';
import { loadAutoBackupConfig, loadAutoBackupState } from './prefs';

const logger = createLogger('Notes-AutoBackup-Reminder');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Fixed notification ids so re-planning replaces instead of accumulating. */
export const BACKUP_REMINDER_IDS = [841_001, 841_002] as const;

/** How long past the cadence point a backup counts as overdue. */
const OVERDUE_GRACE_MS = 2 * HOUR_MS;
/** Minimum lead so a reminder never fires right under the user's fingers. */
const MIN_LEAD_MS = 1 * HOUR_MS;
/** Gap between the first nudge and the long-absence follow-up. */
const FOLLOW_UP_GAP_MS = 6 * DAY_MS;

export interface BackupReminderPlan {
  id: number;
  /** Epoch ms to fire at. */
  at: number;
}

/**
 * Pure scheduling decision (testable under vitest, where the native executor
 * below is dead code): [] = nothing to remind about, cancel any pending.
 */
export function planBackupReminders(args: {
  enabled: boolean;
  /** A write destination exists (folder picked). */
  configured: boolean;
  lastBackupAt: number | null;
  /** Newest data change (the backup watermark); null = no data at all. */
  lastDataChangeAt: number | null;
  intervalHours: number;
  now: number;
}): BackupReminderPlan[] {
  if (!args.enabled || !args.configured) return [];
  // Remind only while something is actually unbacked. With no data there is
  // nothing to back up; with lastBackupAt covering the newest change, the
  // next change happens in-app and re-plans - see the module doc.
  const unbacked =
    args.lastDataChangeAt !== null &&
    (args.lastBackupAt === null || args.lastDataChangeAt > args.lastBackupAt);
  if (!unbacked) return [];
  // No backup yet: measure from now - the first run happens on this very
  // open, and if it fails the next successful run resets the clock anyway.
  const base = args.lastBackupAt ?? args.now;
  const overdueAt = base + args.intervalHours * HOUR_MS + OVERDUE_GRACE_MS;
  const first = Math.max(overdueAt, args.now + MIN_LEAD_MS);
  return [
    { id: BACKUP_REMINDER_IDS[0], at: first },
    { id: BACKUP_REMINDER_IDS[1], at: first + FOLLOW_UP_GAP_MS }
  ];
}

/**
 * Re-plan the pending reminders from the current config/state. Cancel-then-
 * schedule with fixed ids keeps this idempotent - safe to fire after every
 * backup run. Never throws; missing permission just means no reminders.
 */
export async function syncBackupReminders(): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  try {
    const config = loadAutoBackupConfig();
    const state = loadAutoBackupState();
    const { getLastDataChangeAt } = await import('./watermark');
    const lastDataChangeAt = await getLastDataChangeAt();
    const plan = planBackupReminders({
      enabled: config.enabled,
      configured: Boolean(config.folderBookmark),
      // State/watermark keep ISO strings; the planner works in epoch ms.
      lastBackupAt: state.lastBackupAt ? Date.parse(state.lastBackupAt) : null,
      lastDataChangeAt: lastDataChangeAt ? Date.parse(lastDataChangeAt) : null,
      intervalHours: config.intervalHours,
      now: Date.now()
    });

    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({
      notifications: BACKUP_REMINDER_IDS.map((id) => ({ id }))
    });
    if (plan.length === 0) return;

    const { display } = await LocalNotifications.checkPermissions();
    if (display !== 'granted') return;

    // Static localized copy resolved at schedule time (post-unlock, locale
    // loaded) - the export-import.service pattern for i18n outside components.
    const [{ t }, { get }] = await Promise.all([
      import('$lib/stores/i18n.store'),
      import('svelte/store')
    ]);
    const tFn = get(t);
    await LocalNotifications.schedule({
      notifications: plan.map((p) => ({
        id: p.id,
        title: tFn('settings_page.backup.reminder_title'),
        body: tFn('settings_page.backup.reminder_body'),
        schedule: { at: new Date(p.at), allowWhileIdle: true }
      }))
    });
  } catch (err) {
    logger.warn('Failed to (re)schedule backup reminders:', err);
  }
}

/** Drop any pending reminders (backup disabled here / logout wipe). */
export async function cancelBackupReminders(): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({
      notifications: BACKUP_REMINDER_IDS.map((id) => ({ id }))
    });
  } catch (err) {
    logger.warn('Failed to cancel backup reminders:', err);
  }
}

/**
 * Ensure the OS notification permission, prompting if still undecided.
 * Called from the settings page when the user enables auto-backup - the one
 * moment the prompt has obvious context. Returns whether reminders can fire;
 * a denial is fine (backups themselves are unaffected).
 */
export async function ensureReminderPermission(): Promise<boolean> {
  if (!__REBORN_NATIVE__) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    if (current.display === 'denied') return false;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  } catch (err) {
    logger.warn('Notification permission check failed:', err);
    return false;
  }
}
