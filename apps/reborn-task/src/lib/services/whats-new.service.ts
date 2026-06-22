/**
 * "What's new" post-update detection.
 *
 * On startup (deferred so it never competes with the boot path) we compare the
 * running __APP_VERSION__ against the last version the user has already seen
 * notes for. If it is newer AND there is user-facing content for this app +
 * platform in the gap, we raise a toast whose action opens the What's new
 * dialog. The stored "last seen" is always advanced afterwards so the toast
 * shows at most once per update; the dialog stays reachable from Settings.
 *
 * First run on a device records a baseline silently - new users are not greeted
 * with a changelog. Content is bundled and the check is local: the server never
 * learns the client version or what was viewed (guideline 62 zero-telemetry).
 */
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { compareVersions, hasUnseenReleaseNotes } from '@reborn/i18n';
import type { ReleaseApp, ReleasePlatform } from '@reborn/i18n';
import { createLogger } from '@reborn/utils';
import { t } from '$lib/stores/i18n.store';
import { openWhatsNew } from '$lib/stores/whats-new.svelte';

const logger = createLogger('task:whats-new');
const LAST_SEEN_KEY = 'whats_new_last_seen';
const TOAST_DURATION_MS = 12000;

let started = false;

export async function startWhatsNewWatcher(
  app: ReleaseApp,
  platform: ReleasePlatform
): Promise<void> {
  if (!browser || started) return;
  started = true;

  const current = __APP_VERSION__;

  let lastSeen: string | null;
  try {
    lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return; // localStorage unavailable - skip silently
  }

  // First run on this device: record a baseline, don't greet new users.
  if (!lastSeen) {
    safeSet(current);
    return;
  }

  if (compareVersions(current, lastSeen) <= 0) return;

  if (hasUnseenReleaseNotes({ app, platform, lastSeenVersion: lastSeen, currentVersion: current })) {
    promptWhatsNew(current);
  }
  // Advance the baseline regardless so the toast shows at most once per update.
  safeSet(current);
}

function safeSet(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* ignore */
  }
}

function promptWhatsNew(version: string): void {
  logger.info(`New version ${version} available - prompting What's new`);
  const $t = get(t);
  toastStore.info($t('whats_new.updated_toast_title', { values: { version } }), {
    description: $t('whats_new.updated_toast_desc'),
    duration: TOAST_DURATION_MS,
    action: {
      label: $t('whats_new.updated_toast_button'),
      onClick: () => openWhatsNew()
    }
  });
}
