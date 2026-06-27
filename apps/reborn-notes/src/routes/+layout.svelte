<script lang="ts">
  import '../app.css';
  import { onMount, untrack } from 'svelte';
  import { installNativeAuthProbe } from '$lib/utils/native-auth-probe';
  import { get } from 'svelte/store';
  import { Toaster, WhatsNewDialog } from '@reborn/ui';
  import { browser } from '$app/environment';
  import type { Snippet } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { shareDeepLinkToRoute } from '$lib/utils/deep-link';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { initializeStorage, isDatabaseInitialized } from '@reborn/storage';
  import { cryptoManager } from '@reborn/crypto';
  import { getSettings } from '$lib/utils/app-settings';
  import { appSettings } from '$lib/stores/app-settings.store';
  import { syncedSettings } from '$lib/services/synced-settings.service';
  import { foldersStore } from '$lib/stores/folders.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { savedSearchesStore } from '$lib/stores/saved-searches.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { authStore } from '$lib/stores/auth.store';
  import { sharesStore } from '$lib/stores/shares.store';
  import { pullFromServer, pushPendingItems, refreshStoresAfterPull } from '$lib/services/notes-sync.service';
  import { initFolderSync, runFolderSync } from '$lib/services/folder-sync.service';
  import { runNotesAutoBackupIfDue } from '$lib/services/auto-backup';
  import { verifyAndRebuildLocalShadowIndexes } from '$lib/services/shadow-index-reconciler.service';
  import { noteIndex } from '$lib/services/note-index.svelte';
  import { cleanupNullFkFields } from '$lib/services/idb-cleanup.service';
  import { refreshPendingCount, isOnline, sessionExpired, localOnly } from '$lib/stores/sync-status.store';
  import { platform } from '$lib/platform';
  import { initI18n, setLocale, locale } from '$lib/stores/i18n.store';
  import { reAuthenticate, verifyTotpForReauth } from '$lib/services/notes-auth.service';
  import { SessionExpiredBanner, RequireSessionModal } from '@reborn/ui';
  import LoadingScreen from '$lib/components/LoadingScreen.svelte';
  import LocalModeWelcome from '$lib/components/LocalModeWelcome.svelte';
  import UpdateRequiredGate from '$lib/components/layout/UpdateRequiredGate.svelte';
  import { checkNativeUpdateGate } from '$lib/utils/native-app-update';
  import { initAppLock, shouldLockOnResume } from '$lib/services/app-lock.service';
  import { createLogger } from '@reborn/utils';
  import type { ReleasePlatform } from '@reborn/i18n';
  import { whatsNew } from '$lib/stores/whats-new.svelte';
  import { resolveWhatsNewPlatform } from '$lib/utils/whats-new-platform';
  import { maybeShowWhatsNew } from '$lib/services/whats-new.service';

  const logger = createLogger('notes:layout');

  let { children }: { children: Snippet } = $props();

  // What's new dialog: platform drives release-notes filtering; the website
  // changelog (English + /pl only) backs the "Full changelog" link.
  const SITE_URL = (import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? 'https://reapps.eu';
  const changelogHref = $derived(`${SITE_URL}${$locale === 'pl' ? '/pl' : ''}/changelog`);
  let wnPlatform = $state<ReleasePlatform>('web');
  let wnPlatformReady = $state(false);

  let appReady = $state(false);
  let initTimeout = $state(false);
  // Measured height of the session-expired banner. Exposed as --rn-banner-h so
  // the viewport-height containers (main page panels, settings roots) can
  // subtract it: the banner sits in normal flow ABOVE 100dvh layouts, so
  // without the correction it pushes the bottom edge (IconNav avatar) off
  // screen - on iOS the safe-area inset makes the banner taller and the clip
  // obvious, but the overflow exists on web too. 0 when the banner is hidden.
  let sessionBannerHeight = $state(0);
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
      path.startsWith(`${basePath}/auth/lock`) ||
      path.startsWith(`${basePath}/auth/applock`) ||
      path.startsWith(`${basePath}/auth/2fa`);

    // Public read-only share view (/s/{slug}) - no account needed.
    const isPublicShareRoute = path.startsWith(`${basePath}/s/`);

    // A local passcode wrap = local data locked behind a passcode on this
    // origin. Route to the lock screen first, before any account / local-mode
    // decision - a sync, race-free check (the wrap is cleared whenever an
    // account key is set, so its presence unambiguously means local-only +
    // locked) so a still-resolving auth store can't flash the login or unlock
    // form instead of the lock screen.
    if (cryptoManager.isLocalPasscodeLocked() && !isAuthRoute && !isPublicShareRoute) {
      untrack(() => noteIndex.clear());
      untrack(() => {
        goto('/auth/lock');
      });
      return;
    }

    if (
      !$authStore.isAuthenticated &&
      !$authStore.isLocalOnly &&
      !isAuthRoute &&
      !isPublicShareRoute
    ) {
      untrack(() => noteIndex.clear());
      untrack(() => {
        goto('/auth/login');
      });
      return;
    }

    // Native App Lock: key is in the vault but gated behind a biometric prompt
    // (cold start, or resume after the idle timeout). Route to the biometric
    // lock screen before the password-unlock check below, so an account user
    // gets Face ID / fingerprint, not the password form. Inert on web (no
    // vault) and when App Lock is off. See guideline 66.
    if (cryptoManager.isAppLockLocked() && !isAuthRoute && !isPublicShareRoute) {
      untrack(() => noteIndex.clear());
      untrack(() => {
        goto('/auth/applock');
      });
      return;
    }

    if ($authStore.isAuthenticated && !$authStore.hasE2E && !isAuthRoute && !isPublicShareRoute) {
      untrack(() => noteIndex.clear());
      untrack(() => {
        goto('/auth/unlock');
      });
      return;
    }
  });

  // What's new: auto-open the dialog once the app is unlocked and showing
  // content - never over a lock/auth screen. Mirrors the guard above: account
  // user with the E2E key, or local-only, and not gated behind a passcode /
  // App Lock. maybeShowWhatsNew acts at most once and only advances its baseline
  // when it actually runs, so a still-locked session never burns the prompt.
  $effect(() => {
    if (!browser || !appReady || !wnPlatformReady) return;
    const unlocked = ($authStore.isAuthenticated && $authStore.hasE2E) || $authStore.isLocalOnly;
    if (!unlocked) return;
    if (cryptoManager.isLocalPasscodeLocked() || cryptoManager.isAppLockLocked()) return;
    maybeShowWhatsNew('notes', wnPlatform);
  });

  // Re-decrypt all stores when E2E key becomes available (e.g. after unlock/login flow).
  // Also triggers pull from server - covers the case where onMount already ran
  // before authentication completed (login → goto('/') stays within the same SPA session).
  $effect(() => {
    if (!browser) return;
    if (!$authStore.hasE2E) {
      // Locked (or not yet unlocked): allow the NEXT unlock to re-hydrate. The
      // root layout never remounts on a soft lock -> unlock (the lock screen
      // lives under it), so without resetting this one-shot flag the cleared
      // noteIndex would stay empty after a local passcode unlock until a hard
      // reload. Resetting here makes runSync() rebuild on re-unlock. See
      // guideline 64 (local passcode lock/unlock).
      hasTriggeredInitialSync = false;
      return;
    }
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
      // Local-only mode has no server account: skip the settings pull (it would
      // just fail auth and log a warning). Local IDB stays the source of truth.
      if (!get(authStore).isLocalOnly) {
        try {
          const { applied } = await syncedSettings.pullAndMerge();
          if (applied) await appSettings.refresh();
        } catch (err: unknown) {
          logger.warn('Synced settings pull on E2E unlock failed', err);
        }
      }
      // Build NoteIndex FIRST (in parallel with folders/tags), then refresh notesStore
      await Promise.all([
        foldersStore.refresh(),
        tagsStore.refresh(),
        savedSearchesStore.refresh(),
        noteIndex.build()
      ]);
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
      // Live folder sync: scan the linked local directory once the unlock
      // sync settled. No-ops unless configured + auto-sync enabled.
      void runFolderSync('auto');
      // Automated backup: write an encrypted snapshot to the user's folder if
      // due. Native-only and internally gated (enabled + folder + cadence +
      // unchanged-skip), so firing blind here is safe and a no-op on web.
      void runNotesAutoBackupIfDue();
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
      await Promise.all([foldersStore.refresh(), tagsStore.refresh(), savedSearchesStore.refresh()]);

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
          })
          .finally(() => {
            // Live folder sync: scan the linked local directory after the
            // boot sync settles (also offline - the import is local-first).
            void runFolderSync('auto');
          });
      }

      // Initialize pending sync count after stores are loaded
      void refreshPendingCount();

      // i18n is initialized in +layout.ts (before render)

      // Pull E2E synced settings before applying theme/locale so a fresh
      // device sees the user's preferences instead of IDB defaults.
      if (cryptoManager.isInitialized() && !$authStore.isLocalOnly) {
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

    // What's new: resolve the platform so both the Settings dialog and the
    // auto-open effect filter release notes correctly. The dialog itself is
    // opened by the unlock-gated $effect above, never on a fixed timer.
    void resolveWhatsNewPlatform().then((p) => {
      wnPlatform = p;
      wnPlatformReady = true;
    });

    // Initialize network monitoring (sets up online/offline listeners)
    const unsubscribeNetwork = isOnline.subscribe(() => {});

    // Live folder sync triggers (visibility + interval). All conditions
    // (support, config, auth, cooldown) are re-validated inside each run,
    // so this is safe to wire before storage/auth finish initializing.
    const cleanupFolderSync = initFolderSync();

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
    let offDeepLink: (() => void) | undefined;
    let updateGateTimer: ReturnType<typeof setTimeout> | undefined;
    if (__REBORN_NATIVE__) {
      // App Lock: start tracking background time so a resume after the idle
      // timeout re-locks (wires platform.lifecycle.onPause once).
      initAppLock();

      offResume = platform.lifecycle.onResume(() => {
        // App Lock first: if the app was backgrounded past the idle timeout,
        // re-lock and show the biometric screen instead of syncing while
        // unlocked. No-op when App Lock is off.
        if (shouldLockOnResume()) {
          authStore.lockAppNow();
          void goto('/auth/applock');
          return;
        }
        // Min-version gate re-check (throttled internally, fail-open).
        void checkNativeUpdateGate();
        if ($authStore.isAuthenticated && $authStore.hasE2E) {
          pushPendingItems().catch(() => {});
          pullFromServer()
            .then(async (synced) => {
              if (synced) await refreshStoresAfterPull();
            })
            .catch(() => {});
        }
        // Folder sync on return-to-foreground: native has no SW-driven foreground
        // sync and may not fire visibilitychange reliably under capacitor://, so
        // the lifecycle resume is the dependable signal. runFolderSync re-validates
        // support/auth/cooldown/single-flight internally, so firing blind is safe.
        void runFolderSync('auto');
        // Same for the automated backup: gated internally, safe to fire blind.
        void runNotesAutoBackupIfDue();
      });

      // Inbound App Links to a public share (https://<host>/notes/s/<slug>#k=...):
      // route into the in-app read-only viewer, keeping the key fragment
      // client-side (shareDeepLinkToRoute strips the web base, preserves #...).
      // The URL carries the decryption key, so it is never logged. The auth
      // guard $effect treats `/s/` as public, so this works locked or unlocked.
      offDeepLink = platform.deepLinks.onOpen((url) => {
        const route = shareDeepLinkToRoute(url);
        if (route) void goto(route);
      });

      // Min-version gate (Faza 5, plan D5): the first check is deferred a few
      // seconds so it never competes with the boot path (guideline 61 rule);
      // later checks ride the resume handler above.
      updateGateTimer = setTimeout(() => void checkNativeUpdateGate(), 3000);
    }

    return () => {
      clearTimeout(timeoutId);
      clearInterval(syncInterval);
      if (updateGateTimer) clearTimeout(updateGateTimer);
      unsubscribeNetwork();
      cleanupFolderSync();
      offResume?.();
      offDeepLink?.();
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
    // window 'resize' too: in a desktop browser visualViewport.resize fires on a
    // window resize, but the macOS "Designed for iPad" shell (and iPad Stage
    // Manager) can resize the window WITHOUT a reliable vv 'resize', leaving
    // --rn-keyboard-inset / --rn-vv-* stale. Refresh on the window event as well.
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
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
  <div
    class="svelte-app-ready"
    style="display: contents; --rn-banner-h: {sessionBannerHeight}px"
  >
    <div bind:clientHeight={sessionBannerHeight}>
      <SessionExpiredBanner
        visible={$sessionExpired && navigator.onLine && !$localOnly}
        username={$authStore.username ?? ''}
        onReAuth={reAuthenticate}
        onVerifyTotp={verifyTotpForReauth}
      />
    </div>
    <RequireSessionModal
      username={$authStore.username ?? ''}
      onReAuth={reAuthenticate}
      onVerifyTotp={verifyTotpForReauth}
    />
    {@render children()}
    <Toaster />
    <WhatsNewDialog
      bind:open={whatsNew.open}
      app="notes"
      platform={wnPlatform}
      fullChangelogHref={changelogHref}
    />
    <LocalModeWelcome />
    {#if __REBORN_NATIVE__}
      <UpdateRequiredGate />
    {/if}
  </div>
{:else}
  <LoadingScreen />
{/if}

{#if __REBORN_NATIVE__}
  <!-- Brand strip behind the transparent system status bar (PWA parity: on
       the installed web app Chrome paints this area from the theme-color
       meta, #FFD43B). The shells run edge-to-edge (enforced on Android
       15+/16; iOS always worked this way), so the bar's "background" is
       whatever the app draws beneath it - this fixed band, sized by the top
       safe-area inset (0 in landscape), is that background. Icon contrast
       comes from native-system-bars.ts. Rendered outside the app-ready gate
       so the bar is branded from first paint, and above UpdateRequiredGate
       (z-100) because it stands in for a system surface. -->
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-[110] h-[env(safe-area-inset-top,0px)] bg-[#FFD43B]"
    aria-hidden="true"
  ></div>
{/if}
