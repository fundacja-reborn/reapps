/**
 * Service Worker Update Detection
 *
 * When a new service worker version is deployed, the browser fetches and installs
 * it in the background. Because our SW calls `skipWaiting()` during install, the
 * new SW takes control immediately — but the currently-loaded page is still
 * running the OLD JS bundle. To avoid serving stale code indefinitely, we:
 *
 *   1. Listen for `updatefound` on the registration to detect incoming updates.
 *   2. When the new worker reaches `installed` state AND there was already a
 *      controller (i.e. this is NOT the first install), prompt the user to
 *      reload via a toast with an "Odśwież" action.
 *   3. Eagerly call `registration.update()` once on init and again whenever
 *      the document becomes visible (throttled). Important on iOS PWAs where
 *      the service worker is paused aggressively between app resumes — without
 *      this, the update toast can take many minutes to appear after a cold
 *      start. On Android/desktop the cost is one extra HEAD-equivalent request.
 *   4. Poll `registration.update()` every hour to catch updates in long-lived
 *      tabs (otherwise the browser only checks on navigation).
 *
 * We intentionally do NOT auto-reload — a forced reload would interrupt
 * in-progress edits/encryption. The toast stays visible until the user
 * explicitly dismisses or reloads.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { toastStore } from '@reborn/ui';
import { createLogger } from '@reborn/utils';
import { t } from '$lib/stores/i18n.store';

const logger = createLogger('SwUpdateService');

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const VISIBILITY_UPDATE_THROTTLE_MS = 60 * 1000; // min 1 min between visibility-triggered checks

let started = false;
let alreadyPrompted = false;
let lastUpdateCheckAt = 0;

export function startSwUpdateWatcher(): void {
  if (!browser || started) return;
  if (!('serviceWorker' in navigator)) return;
  started = true;

  void init();
}

async function init(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;

    // Handle both cases: the installing worker may exist at the time
    // `ready` resolves, or the browser may fire `updatefound` later.
    if (registration.installing) {
      trackInstalling(registration.installing);
    }
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) trackInstalling(newWorker);
    });

    // Eager check — on iOS PWAs the SW is paused between resumes; without
    // this the toast can lag minutes after a cold start.
    void triggerUpdate(registration, 'init');

    // Re-check whenever the user returns to the tab (covers iPad app-switcher
    // resume, desktop tab focus, Android task-switch). Throttled.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void triggerUpdate(registration, 'visibilitychange');
    });

    // Periodic check — catches updates in tabs that stay open for hours.
    setInterval(() => {
      void triggerUpdate(registration, 'interval');
    }, UPDATE_CHECK_INTERVAL_MS);

    logger.info('SW update watcher started');
  } catch (error: unknown) {
    logger.error('Failed to start SW update watcher', error);
  }
}

async function triggerUpdate(
  registration: ServiceWorkerRegistration,
  source: 'init' | 'visibilitychange' | 'interval'
): Promise<void> {
  // Throttle visibility-triggered checks — `visibilitychange` can fire many
  // times in quick succession (e.g. tab switching). Init/interval bypass.
  if (source === 'visibilitychange') {
    const now = Date.now();
    if (now - lastUpdateCheckAt < VISIBILITY_UPDATE_THROTTLE_MS) return;
    lastUpdateCheckAt = now;
  } else {
    lastUpdateCheckAt = Date.now();
  }

  try {
    await registration.update();
  } catch (err) {
    logger.debug(`SW update check failed (${source})`, err);
  }
}

function trackInstalling(worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'installed') return;
    // No controller means this is the first-ever install — nothing stale
    // to replace, so no need to prompt the user.
    if (!navigator.serviceWorker.controller) return;

    promptReload();
  });
}

function promptReload(): void {
  if (alreadyPrompted) return;
  alreadyPrompted = true;

  logger.info('New service worker version available — prompting user to reload');

  const $t = get(t);

  toastStore.info($t('app.sw_update.title'), {
    description: $t('app.sw_update.description'),
    duration: Number.POSITIVE_INFINITY,
    action: {
      label: $t('app.sw_update.button'),
      onClick: () => window.location.reload()
    }
  });
}
