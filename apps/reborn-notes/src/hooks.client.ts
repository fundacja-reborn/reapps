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
import { createNativeMasterKeyVault } from '$lib/utils/native-master-key-vault';
import { applyNativeStatusBarStyle } from '$lib/utils/native-system-bars';

// Public read-only share view (/s/<slug>) runs before the layout's onMount
// bypass, so we have to short-circuit storage init here too. Without this
// guard, initializeStorage('notes') below would allocate an empty
// Reborn_notes_DB in every anonymous visitor's browser. See guideline 59.
const isPublicShareRoute =
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith(`${base}/s/`);

// Native: persist the master key through the device vault (Android
// Keystore / iOS Keychain-wrapped) instead of an extractable CryptoKey in
// IndexedDB. Must be wired BEFORE the first waitForRestore() call anywhere -
// the restoration source is decided when the lazy restore runs. Deliberately
// outside the isPublicShareRoute guard: the injection is pure state (no IO,
// guideline 59 rule #12 holds) and a session entered via a share deep link
// must still use the vault once the user navigates into the app.
if (__REBORN_NATIVE__) {
  cryptoManager.setMasterKeyVault(createNativeMasterKeyVault());

  // The shell must not run a Service Worker: assets are bundled locally, so a
  // SW adds only a cache layer that can serve a stale shell after a store
  // update. Registration is off for native builds (svelte.config.js
  // `serviceWorker.register`); this sweep cleans up SWs already registered by
  // earlier dev builds, which auto-registered one on Android (`http://localhost`
  // is SW-capable - on iOS the API is absent under `capacitor://`, hence the
  // feature guard).
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      })
      .catch(() => {});
  }

  // Best-effort storage durability. iOS can evict WKWebView website data
  // (IndexedDB) under disk pressure; where the Storage API exists this asks
  // the OS not to. Optional chaining: the API is absent in some webviews.
  // Eviction stays survivable regardless - the server holds all encrypted
  // data and the master key / refresh token live in Keychain/Keystore, so
  // recovery is a silent re-sync (see planning/native-faza4-plan.md, D3).
  void navigator.storage?.persist?.()?.catch(() => {});

  // Status-bar icons: dark over the brand band the root layout paints behind
  // the transparent system bar (PWA parity). Cosmetic fire-and-forget.
  void applyNativeStatusBarStyle();
}

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

  // Web-PWA-only flows: the SW update toast is meaningless in the native
  // shell (code updates arrive via the store, never via a SW swap) and
  // `beforeinstallprompt` never fires inside a webview. Gated so the native
  // build drops both watchers.
  if (!__REBORN_NATIVE__) {
    startSwUpdateWatcher();
    startPwaInstallPrompt();
  }

  // Initialize storage early — before SvelteKit layout mounts.
  // This is fire-and-forget: if it fails, +layout.svelte will retry in onMount.
  initializeStorage('notes')
    .then(async () => {
      // Auto-purge old trash items (notes trashed more than 30 days ago) and
      // any leftover pristine ephemeral notes - New Note rows the user created
      // but never touched, then reloaded/closed before the in-session discard
      // could run (#349). Both are local-only, no decryption needed.
      try {
        const { cleanTrash, cleanEphemeralNotes } = await import('$lib/services/note.service');
        await cleanTrash(30);
        await cleanEphemeralNotes();
      } catch {
        // Non-critical — trash cleanup is also attempted in layout onMount
      }
    })
    .catch(() => {
      // Storage init failed — layout onMount will handle retry
    });
}
