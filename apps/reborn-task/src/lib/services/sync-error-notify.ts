/**
 * User-facing toast for permanent push rejections (sync_status: 'sync_error').
 *
 * Kept out of the sync engine so it stays free of UI imports and can be mocked
 * in sync tests. The persistent surfaces (red footer count + per-task badge +
 * inline reason) are driven by store state; this toast is the one-shot "it just
 * happened" signal after a batch push. Mirrors notes' `sync-error-notify.ts`.
 */
import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { t } from '$lib/stores/i18n.store';
import type { SyncErrorCode } from '@reborn/types';

/** Localised one-line reason for a given rejection code (used inline + in toasts). */
export function syncErrorMessage(code: SyncErrorCode): string {
	const $t = get(t);
	switch (code) {
		case 'too_large':
			return $t('sync.errors.too_large');
		case 'quota_exceeded':
			return $t('sync.errors.quota_exceeded');
		case 'invalid':
			return $t('sync.errors.invalid');
		case 'rejected':
			return $t('sync.errors.rejected');
	}
}

/**
 * One aggregated toast after a sync left `count` items permanently rejected.
 *
 * Intentionally a count + pointer, not a list: a batch can reject several
 * items, and a toast is transient. The per-item reason is shown inline on each
 * marked task row (TaskItem), which is where the user goes to act.
 */
export function notifyTaskSyncErrors(count: number): void {
	if (count <= 0) return;
	const $t = get(t);
	toastStore.error($t('sync.errors.toast_batch', { values: { count } }), {
		description: $t('sync.errors.toast_marked')
	});
}
