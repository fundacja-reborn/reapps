/**
 * "What's new" post-update auto-open.
 *
 * Called once the app is unlocked and showing content - the caller gates on
 * auth/unlock state, so the dialog never opens over a lock or auth screen. We
 * compare the running __APP_VERSION__ against the last version the user has
 * already seen release notes for; if it is newer AND there is user-facing
 * content for this app + platform in the gap, we open the What's new dialog
 * directly (no intermediate toast).
 *
 * The stored "last seen" is advanced only once we have acted, so the dialog
 * opens at most once per update and is never burned while the app is still
 * locked - we simply get called again after unlock.
 *
 * First run on a device records a baseline silently - new users are not greeted
 * with a changelog. Content is bundled and the check is local: the server never
 * learns the client version or what was viewed (guideline 62 zero-telemetry).
 */
import { browser } from '$app/environment';
import { compareVersions, hasUnseenReleaseNotes } from '@reborn/i18n';
import type { ReleaseApp, ReleasePlatform } from '@reborn/i18n';
import { createLogger } from '@reborn/utils';
import { openWhatsNew } from '$lib/stores/whats-new.svelte';

const logger = createLogger('notes:whats-new');
const LAST_SEEN_KEY = 'whats_new_last_seen';

let done = false;

export function maybeShowWhatsNew(app: ReleaseApp, platform: ReleasePlatform): void {
  if (!browser || done) return;

  const current = __APP_VERSION__;

  let lastSeen: string | null;
  try {
    lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    done = true; // localStorage unavailable - don't retry this session
    return;
  }

  // First run on this device: record a baseline, don't greet new users.
  if (!lastSeen) {
    done = true;
    safeSet(current);
    return;
  }

  // We are unlocked and acting now: do this at most once per session.
  done = true;

  if (compareVersions(current, lastSeen) <= 0) return;

  if (hasUnseenReleaseNotes({ app, platform, lastSeenVersion: lastSeen, currentVersion: current })) {
    logger.info(`Updated to ${current} - opening What's new`);
    openWhatsNew();
  }
  // Advance the baseline regardless so this stays a once-per-update event.
  safeSet(current);
}

function safeSet(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* ignore */
  }
}
