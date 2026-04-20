import type { HandleClientError } from '@sveltejs/kit';
import { LoggerGlobal, LOG_LEVELS } from '@reborn/utils';
import { initializeStorage } from '@reborn/storage';

// Enable debug logs only in Vite dev server (import.meta.hot is stripped in production builds).
if (import.meta.hot) {
  LoggerGlobal.setMinLevel(LOG_LEVELS.DEBUG);
}
import { startSwUpdateWatcher } from '$lib/services/sw-update.service';
import { startPwaInstallPrompt } from '$lib/services/pwa-install.service';

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
