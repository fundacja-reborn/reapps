<script lang="ts">
  import '../app.css';
  import { onMount, untrack } from 'svelte';
  import { installNativeAuthProbe } from '$lib/utils/native-auth-probe';
  import { get } from 'svelte/store';
  import { Toaster } from '@reborn/ui';
  import { browser } from '$app/environment';
  import type { Snippet } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { initializeStorage, isDatabaseInitialized } from '@reborn/storage';
  import { cryptoManager } from '@reborn/crypto';
  import { getSettings } from '$lib/utils/app-settings';
  import { appSettings } from '$lib/stores/app-settings.store';
  import { syncedSettings } from '$lib/services/synced-settings.service';
  import { foldersStore } from '$lib/stores/folders.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { authStore } from '$lib/stores/auth.store';
  import { sharesStore } from '$lib/stores/shares.store';
  import { pullFromServer, pushPendingItems, refreshStoresAfterPull } from '$lib/services/notes-sync.service';
  import { verifyAndRebuildLocalShadowIndexes } from '$lib/services/shadow-index-reconciler.service';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { cleanupNullFkFields } from '$lib/services/idb-cleanup.service';
  import { refreshPendingCount, isOnline, sessionExpired } from '$lib/stores/sync-status.store';
  import { platform } from '$lib/platform';
  import { initI18n, setLocale, locale } from '$lib/stores/i18n.store';
  import { reAuthenticate, verifyTotpForReauth } from '$lib/services/notes-auth.service';
  import { SessionExpiredBanner, RequireSessionModal } from '@reborn/ui';
  import LoadingScreen from '$lib/components/LoadingScreen.svelte';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('notes:layout');

  let { children }: { children: Snippet } = $props();

  let appReady = $state(false);
  let initTimeout = $state(false);
  let hasTriggeredInitialSync = $state(false);

  // Auth guard - blocked until onMount finishes initialization (appReady).
  // Uses untrack on goto() to prevent reactive dependency on navigation result.
  $effect(() => {
    if (!browser || !appReady) return;
    const path = $page.url.pathname;
    const basePath = base || '';
    const isAuthRoute =
      path === `${basePath}/auth/login` ||
      path.startsWith(`${basePath}/auth/login`) ||
      path.startsWith(`${basePath}/auth/register`) ||
      path.startsWith(`${basePath}/auth/unlock`) ||
      path.startsWith(`${basePath}/auth/2fa`);

    // Public read-only share view (/s/{slug}) - no account needed.
    const isPublicShareRoute = path.startsWith(`${basePath}/s/`);

    if (!$authStore.isAuthenticated && !isAuthRoute && !isPublicShareRoute) {
      untrack(() => noteIndex.clear());
      untrack(() => {
        goto('/auth/login');
      });
      return;
    }

    if ($authStore.isAuthenticated && !$authStore.hasE2E && !isAuthRoute && !isPublicShareRoute) {
      untrack(() => noteIndex.clear());
      untrack(() => {
        goto('/auth/unlock');
      });
    }
  });

  // Re-decrypt all stores when E2E key becomes available (e.g. after unlock/login flow).
  // Also triggers pull from server - covers the case where onMount already ran
  // before authentication completed (login → goto('/') stays within the same SPA session).
  $effect(() => {
    if (!browser || !$authStore.hasE2E) return;
    if (hasTriggeredInitialSync) return; // onMount already kicked off a pull

    hasTriggeredInitialSync = true;
    const runSync = async () => {
      // Re-initialize storage if the connection was terminated
      // (e.g. user deleted IndexedDB in DevTools while the app was open).
      // initializeStorage() is idempotent - safe to call unconditionally.
      if (!isDatabaseInitialized()) {
        await initializeStorage('notes');
      }
      // Pull E2E synced settings now that the master key is available.
      // Re-init appSettings so theme/locale reflect the server state.
      try {
        const { applied } = await syncedSettings.pullAndMerge();
        if (applied) await appSettings.refresh();
      } catch (err: unknown) {
        logger.warn('Synced settings pull on E2E unlock failed', err);
      }
      // Build NoteIndex FIRST (in parallel with folders/tags), then refresh notesStore
      await Promise.all([foldersStore.refresh(), tagsStore.refresh(), noteIndex.build()]);
      notesStore.refresh();
      // Push pending offline edits BEFORE pull - otherwise pullFromServer's
      // version checks could mask unsynced local changes on the next write.
      await pushPendingItems().catch(() => {});
      const synced = await pullFromServer();
      if (synced) {
        // Repair any shadow-index drift from earlier pulls where crypto wasn't
        // ready when metadata_encrypted was decoded. sync_version guard in
        // pullNotes hides this corruption forever otherwise; run before the
        // post-pull refresh so the rebuilt noteIndex sees the fixed rows.
        await verifyAndRebuildLocalShadowIndexes().catch((err) =>
          logger.warn('Shadow-index reconcile failed', err)
        );
        await refreshStoresAfterPull();
      }
    };
    // fire-and-forget: initial sync, errors handled by sync service
    runSync().catch(() => {});
  });

  onMount(() => {
    if (!browser) return;

    // Native-only dev probe for refresh-token rotation validation (no-op on web).
    installNativeAuthProbe();

    // Timeout fallback - show app even if initialization stalls (e.g. slow IndexedDB)
    const timeoutId = setTimeout(() => {
      initTimeout = true;
    }, 2000);

    // Media query listener for system color scheme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSchemeChange = () => applyTheme('system');

    const init = async () => {
      // Public read-only share view (/s/[slug]) bypass: no auth, no IndexedDB,
      // no sync needed. The snapshot page fetches its own ciphertext and
      // decrypts client-side with the URL-fragment key. Without this guard,
      // initializeStorage() would create an empty Reborn_notes_DB in the
      // visitor's browser - bloat + storage pollution for anonymous viewers.
      // The theme-flash inline script in app.html has already applied the
      // right dark/light class from localStorage + prefers-color-scheme, so
      // we don't need appSettings.init() either. See guideline 59.
      const basePath = base || '';
      if (window.location.pathname.startsWith(`${basePath}/s/`)) {
        appReady = true;
        return;
      }

      // 1. Wait for CryptoManager to restore key from sessionStorage (if any)
      await cryptoManager.waitForRestore();

      // 2. Initialize IndexedDB storage (notes, folders, settings)
      if (!isDatabaseInitialized()) {
        try {
          await initializeStorage('notes');
        } catch (e: unknown) {
          logger.error('Failed to initialize storage:', e);
        }
      }

      // 2a. Initialize SSO auth state AFTER storage is ready and BEFORE the
      //     cleanup migration - cleanup repairs malformed user_id in legacy
      //     local records, which needs the current account's UUID.
      //     (reads shared localStorage from reborn-task if same origin)
      authStore.initialize();

      // 2b. One-shot cleanup of legacy null FK fields + malformed user_id in
      //     IDB. Idempotent and gated by a versioned localStorage flag - runs
      //     once per browser profile per migration version. Awaited so it
      //     completes before sync touches the same records. Bounded by local
      //     IDB size (typically <1s). Re-runs on next boot if user_id repair
      //     was skipped because auth wasn't ready.
      await cleanupNullFkFields(get(authStore).userId);

      // 3. Wire the shares store so the per-note badge / IconNav badge stay in
      //    sync across lock/unlock cycles. init() is idempotent and self-guards
      //    on crypto.isInitialized() - safe to call here even on a fresh app
      //    boot before the user has unlocked their master key. See guideline 59.
      sharesStore.init();

      // 4. Mark app as ready - unblocks auth guard $effect
      appReady = true;

      // Refresh stores now that the database is initialized
      await Promise.all([foldersStore.refresh(), tagsStore.refresh()]);

      // Pull sync from server (if authenticated and E2E unlocked) - then refresh local stores
      if ($authStore.isAuthenticated && $authStore.hasE2E) {
        hasTriggeredInitialSync = true; // prevent $effect from duplicating pull
        // Build NoteIndex in parallel with folders/tags (data already in IndexedDB from init above)
        await noteIndex.build();
        notesStore.refresh();
        // Push pending offline edits BEFORE pull - guarantees local unsynced
        // changes reach the server before we merge the remote state in.
        pushPendingItems()
          .catch(() => {})
          .then(() => pullFromServer())
          .then(async (synced) => {
            if (synced) {
              // See $effect runSync above for why shadow-index reconcile runs
              // here too: cold-start unlock with corrupted IDB rows from a
              // previous session needs the same self-healing path.
              await verifyAndRebuildLocalShadowIndexes().catch((err) =>
                logger.warn('Shadow-index reconcile failed', err)
              );
              await refreshStoresAfterPull();
            }
          })
          .catch(() => {
            /* offline - local data remains */
          });
      }

      // Initialize pending sync count after stores are loaded
      void refreshPendingCount();

      // i18n is initialized in +layout.ts (before render)

      // Pull E2E synced settings before applying theme/locale so a fresh
      // device sees the user's preferences instead of IDB defaults.
      if (cryptoManager.isInitialized()) {
        try {
          await syncedSettings.pullAndMerge();
        } catch (err: unknown) {
          logger.warn('Synced settings pull failed - falling back to local IDB', err);
        }
      }

      try {
        await appSettings.init();
        const settings = await getSettings();

        if (settings?.language) {
          await setLocale(settings.language);
        }
      } catch {
        // Fallback: use system preference
        applyTheme('system');
      }

      // Watch system color scheme changes
      mediaQuery.addEventListener('change', handleSchemeChange);
    };

    init().catch((e) => {
      logger.error('Initialization failed:', e);
    });

    // Initialize network monitoring (sets up online/offline listeners)
    const unsubscribeNetwork = isOnline.subscribe(() => {});

    // Periodic sync every 5 minutes when online and authenticated
    const syncInterval = setInterval(
      () => {
        if ($authStore.isAuthenticated && $authStore.hasE2E && navigator.onLine) {
          // fire-and-forget: periodic sync, errors handled internally
          pushPendingItems().catch(() => {});
          pullFromServer()
            .then(async (synced) => {
              if (synced) await refreshStoresAfterPull();
            })
            .catch(() => {});
        }
      },
      5 * 60 * 1000
    );

    // Native: there is no Service Worker under capacitor://, so returning to the
    // foreground (App 'resume') drives the sync that the SW + online-transition
    // handler cover on web. Push BEFORE pull (same ordering as everywhere else)
    // so a pull can't overwrite still-pending offline edits. Native-only -> the
    // whole block is dead-code-eliminated from the web bundle.
    let offResume: (() => void) | undefined;
    if (__REBORN_NATIVE__) {
      offResume = platform.lifecycle.onResume(() => {
        if ($authStore.isAuthenticated && $authStore.hasE2E) {
          pushPendingItems().catch(() => {});
          pullFromServer()
            .then(async (synced) => {
              if (synced) await refreshStoresAfterPull();
            })
            .catch(() => {});
        }
      });
    }

    return () => {
      clearTimeout(timeoutId);
      clearInterval(syncInterval);
      unsubscribeNetwork();
      offResume?.();
      mediaQuery.removeEventListener('change', handleSchemeChange);
    };
  });

  // Sync document lang attribute with current locale
  $effect(() => {
    if (browser && $locale) {
      document.documentElement.lang = $locale;
    }
  });

  // iOS Safari safety net + visual-viewport tracker.
  //
  // Safety net: app.css locks <html>/<body> with position:fixed, but if Safari
  // ever ends up with non-zero scrollTop on the document element (race during
  // font load, focus before stylesheet apply, …), the app header would slide
  // off-screen. Reset document scroll on every window scroll / vv resize.
  //
  // Visual-viewport tracker: when the soft keyboard opens on iOS Safari, the
  // layout viewport doesn't shrink (100dvh stays full size) and Safari may
  // "page-shift" the layout viewport upward to keep the focused contenteditable
  // visible - pushing our sticky header above the visible area. Mirror the
  // current visualViewport state into CSS vars so the mobile note panel can
  // size itself to vv.height and counter-translate by vv.offsetTop, keeping
  // the header anchored to the top of the visible area regardless of caret
  // position. Used in apps/reborn-notes/src/routes/+page.svelte (mobile root).
  $effect(() => {
    if (!browser) return;
    const root = document.documentElement;
    const vv = window.visualViewport;

    const update = () => {
      // Public share view (/s/[slug]) opts out of the body scroll-lock so the
      // page can use the native browser scrollbar. Skip the safety reset and
      // visual-viewport tracking here - none of it applies to the read-only
      // share page (no contenteditable, no keyboard, no mobile note panel).
      if (root.classList.contains('share-view')) return;

      if (root.scrollTop !== 0) root.scrollTop = 0;
      if (document.body.scrollTop !== 0) document.body.scrollTop = 0;

      if (!vv) return;
      // Round to integers - sub-pixel jitter from iOS during scroll causes
      // useless reflows.
      const h = Math.round(vv.height);
      const offsetTop = Math.round(vv.offsetTop);
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--rn-vv-height', `${h}px`);
      root.style.setProperty('--rn-vv-offset-top', `${offsetTop}px`);
      root.style.setProperty('--rn-keyboard-inset', `${inset}px`);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  });

  function applyTheme(theme: 'light' | 'dark' | 'system') {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
    // Cache for inline script in app.html
    try {
      localStorage.setItem('reborn-notes-theme', theme);
    } catch {
      /* */
    }
  }
</script>

{#if appReady || initTimeout}
  <!-- `svelte-app-ready` lets the inline loading indicator in app.html hide
       itself via `body:has(.svelte-app-ready) #app-loading`. `display: contents`
       keeps the wrapper transparent to the layout flow. -->
  <div class="svelte-app-ready" style="display: contents">
    <SessionExpiredBanner
      visible={$sessionExpired && navigator.onLine}
      username={$authStore.username ?? ''}
      onReAuth={reAuthenticate}
      onVerifyTotp={verifyTotpForReauth}
    />
    <RequireSessionModal
      username={$authStore.username ?? ''}
      onReAuth={reAuthenticate}
      onVerifyTotp={verifyTotpForReauth}
    />
    {@render children()}
    <Toaster />
  </div>
{:else}
  <LoadingScreen />
{/if}
