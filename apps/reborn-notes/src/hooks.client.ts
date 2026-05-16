import type { HandleClientError } from '@sveltejs/kit';
import { LoggerGlobal, LOG_LEVELS } from '@reborn/utils';
import { initializeStorage } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { base } from '$app/paths';

// Enable debug logs only in Vite dev server (import.meta.hot is stripped in production builds).
if (import.meta.hot) {
  LoggerGlobal.setMinLevel(LOG_LEVELS.DEBUG);
}
import { startSwUpdateWatcher } from '$lib/services/sw-update.service';
import { startPwaInstallPrompt } from '$lib/services/pwa-install.service';

// Public read-only share view (/s/<slug>) runs before the layout's onMount
// bypass, so we have to short-circuit storage init here too. Without this
// guard, initializeStorage('notes') below would allocate an empty
// Reborn_notes_DB in every anonymous visitor's browser. See guideline 59.
const isPublicShareRoute =
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith(`${base}/s/`);

// ---------------------------------------------------------------------------
// Client-side error handler — detect offline chunk-loading failures
// ---------------------------------------------------------------------------
export const handleError: HandleClientError = ({ error }) => {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const isDynamicImportFailure =
    error instanceof TypeError &&
    (/dynamically imported module/i.test(error.message) ||
      /failed to fetch/i.test(error.message));

  if (isDynamicImportFailure && isOffline) {
    return {
      message: 'Jesteś offline — ta strona nie jest jeszcze dostępna.',
      isOffline: true
    };
  }

  return {
    message: (error as Error)?.message ?? 'Wystąpił nieoczekiwany błąd.'
  };
};

// Start watching for service worker updates — shows a toast when a new
// version is deployed so the user can reload to pick up fresh code.
// Skipped on /s/<slug> — service worker is bypassed there per rule #9.
if (!isPublicShareRoute) {
  // Kick off lazy master-key restoration as early as possible so the layout's
  // awaited waitForRestore() resolves immediately on cold start instead of
  // racing the 5s i18n timeout in +layout.ts. Restoration is now lazy on
  // @reborn/crypto import (guideline 59 rule #12) — the call here puts us
  // back at the pre-share-snapshot timing for normal routes.
  void cryptoManager.waitForRestore().catch(() => {});

  startSwUpdateWatcher();
  startPwaInstallPrompt();

  // Initialize storage early — before SvelteKit layout mounts.
  // This is fire-and-forget: if it fails, +layout.svelte will retry in onMount.
  initializeStorage('notes')
    .then(async () => {
      // Auto-purge old trash items (notes trashed more than 30 days ago)
      try {
        const { cleanTrash } = await import('$lib/services/note.service');
        await cleanTrash(30);
      } catch {
        // Non-critical — trash cleanup is also attempted in layout onMount
      }
    })
    .catch(() => {
      // Storage init failed — layout onMount will handle retry
    });
}
