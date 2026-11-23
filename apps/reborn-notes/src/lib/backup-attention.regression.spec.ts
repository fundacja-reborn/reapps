import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The automatic backup used to report trouble only in Settings > Automatic
// backup, as a raw English error ("Failed to write to the folder", desktop
// smoke 2026-11-23). Now the notes view shows a notice above the sync status
// with the reason and the fix, and Settings never promises a reminder the
// system was never asked about.
const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf-8');
const footer = read('components/sync/SyncStatusFooter.svelte');
const notice = read('components/sync/BackupAttentionNotice.svelte');
const settings = read('../routes/settings/backup/+page.svelte');

describe('backup notice in the notes view', () => {
  it('sits in the sync footer of the native builds', () => {
    expect(footer).toContain('const backupNotice = __REBORN_NATIVE__;');
    expect(footer).toMatch(/\{#if backupNotice\}\s*<BackupAttentionNotice \/>/);
  });

  it('shows the reason, not only that the backup failed', () => {
    expect(notice).toContain('backupProblemText(attention.problem, attention.detail, $t)');
    expect(notice).toContain("$t('backup_attention.no_phrase')");
  });

  it('offers picking the folder again and backing up now', () => {
    expect(notice).toContain('pickBackupFolderAndBackUp()');
    expect(notice).toContain('backUpNow()');
  });
});

describe('backup settings and notifications', () => {
  it('explains a lost or missing folder instead of the raw error', () => {
    expect(settings).toContain(
      'backupProblemText(backupProblem(bstate.lastErrorCode), bstate.lastError, $t)'
    );
    expect(settings).toContain('values: { error: statusError }');
  });

  it('asks for notifications on a click instead of promising a reminder', () => {
    const prompt = settings.slice(settings.indexOf("reminderPermission === 'prompt'"));
    expect(prompt).toContain('onclick={allowReminders}');
    expect(settings).toContain("cfg.enabled && reminderPermission === 'granted'");
  });

  it('opens the system notification settings where the platform can', () => {
    const denied = settings.slice(
      settings.indexOf("reminderPermission === 'denied'"),
      settings.indexOf("reminderPermission === 'prompt'")
    );
    expect(denied).toContain('{#if canOpenSystemSettings}');
    expect(denied).toContain('onclick={openSystemNotificationSettings}');
  });
});
