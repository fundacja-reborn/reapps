import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { PUBLIC_BASE_PATH } from '$env/static/public';
import { authFetch } from '$lib/utils/auth-fetch';
import { createLogger } from '@reborn/utils';

const logger = createLogger('StorageQuota');

// ── Stores ───────────────────────────────────────────────────────

export const quotaUsedBytes = writable(0);
export const quotaLimitBytes = writable(0);
export const quotaPercent = writable(0);
export const quotaLoading = writable(false);

/** Per-component breakdown of `quotaUsedBytes`. Components sum to the total. */
export const quotaNotesBytes = writable(0);
export const quotaVersionsBytes = writable(0);
export const quotaSharesBytes = writable(0);

/** Whether the user has exceeded their storage quota. */
export const isOverQuota = derived(
  [quotaUsedBytes, quotaLimitBytes],
  ([$used, $limit]) => $limit > 0 && $used >= $limit
);

/** Whether usage is above the warning threshold (90%). */
export const isQuotaWarning = derived(
  [quotaPercent],
  ([$percent]) => $percent >= 90 && $percent < 100
);

// ── Fetch quota from server ──────────────────────────────────────

export async function refreshQuota(): Promise<void> {
  if (!browser) return;

  quotaLoading.set(true);
  try {
    const res = await authFetch(`${PUBLIC_BASE_PATH}/api/user/quota`);
    if (!res.ok) return;

    const json = await res.json();
    if (json.success && json.data) {
      quotaUsedBytes.set(json.data.used_bytes);
      quotaLimitBytes.set(json.data.limit_bytes);
      quotaPercent.set(json.data.usage_percent);
      // Breakdown may be absent on legacy servers - default to zeros.
      const breakdown = json.data.breakdown ?? {};
      quotaNotesBytes.set(breakdown.notes_bytes ?? 0);
      quotaVersionsBytes.set(breakdown.versions_bytes ?? 0);
      quotaSharesBytes.set(breakdown.shares_bytes ?? 0);
    }
  } catch (err) {
    logger.error('Failed to fetch quota:', err);
  } finally {
    quotaLoading.set(false);
  }
}
