/**
 * User-facing toasts for permanent push rejections (sync_status: 'sync_error').
 *
 * Kept out of `notes-sync.service.ts` so the sync engine stays free of UI
 * imports and these helpers can be mocked in sync tests. The persistent
 * surfaces (red footer count + per-note badge) are driven by store state; these
 * toasts are the one-shot "it just happened" signal.
 */
import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { t } from '$lib/stores/i18n.store';
import { MAX_NOTE_CONTENT_BYTES, type SyncErrorCode } from '@reborn/types';

/** Note content limit in KB, for the 'too_large' message (matches the editor indicator). */
function limitKb(): number {
  return Math.round(MAX_NOTE_CONTENT_BYTES / 1000);
}

/** Localised one-line reason for a given rejection code. */
export function syncErrorMessage(code: SyncErrorCode): string {
  const $t = get(t);
  switch (code) {
    case 'too_large':
      return $t('sync_status.errors.too_large', { values: { max: limitKb() } });
    case 'quota_exceeded':
      return $t('sync_status.errors.quota_exceeded');
    case 'invalid':
      return $t('sync_status.errors.invalid');
    case 'rejected':
      return $t('sync_status.errors.rejected');
  }
}

/** Toast for a single note rejected during an interactive create/edit push. */
export function notifyNoteSyncError(code: SyncErrorCode): void {
  const $t = get(t);
  toastStore.error($t('sync_status.errors.toast_single'), {
    description: syncErrorMessage(code)
  });
}

/**
 * One aggregated toast after a batch push left `count` notes rejected.
 *
 * Intentionally a count + pointer, not a list: a batch can reject many notes,
 * and a toast is transient. The per-note reason is shown inline on each marked
 * row (NoteListItem), which is where the user goes to act.
 */
export function notifyBatchSyncErrors(count: number): void {
  if (count <= 0) return;
  const $t = get(t);
  toastStore.error($t('sync_status.errors.toast_batch', { values: { count } }), {
    description: $t('sync_status.errors.toast_marked')
  });
}
