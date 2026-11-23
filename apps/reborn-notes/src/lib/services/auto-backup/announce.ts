/**
 * The answer to a "back up now" outside Settings (the notice in the notes
 * view, the desktop menu): a short toast. Settings shows its own result line
 * next to its button instead.
 *
 * A failure gets the reason, not only "failed" (guideline 02); the notice in
 * the notes view keeps it after the toast is gone.
 */

import { get } from 'svelte/store';
import { goto } from '$lib/utils/navigation';
import type { AutoBackupOutcome } from '@reborn/backup';
import { toastStore } from '@reborn/ui';
import { t } from '$lib/stores/i18n.store';
import { backupProblem, backupProblemText } from './attention';

export function announceBackupNow(outcome: AutoBackupOutcome): void {
  const translate = get(t);
  switch (outcome.status) {
    case 'backed-up':
      toastStore.success(translate('settings_page.backup.now_done'));
      return;
    case 'error':
      toastStore.error(
        translate('settings_page.backup.now_failed', {
          values: {
            error: backupProblemText(backupProblem(outcome.code), outcome.error, translate)
          }
        })
      );
      return;
    case 'skipped':
      switch (outcome.reason) {
        case 'no-data':
          toastStore.info(translate('settings_page.backup.now_nothing'));
          return;
        case 'disabled':
        case 'no-destination':
        case 'no-phrase':
          // Not set up (or set up without a phrase on this device): Settings
          // is where that gets done.
          void goto('/settings/backup');
          return;
        default:
          // `locked` / `not-due` do not happen for a forced run from an
          // unlocked view.
          return;
      }
  }
}
