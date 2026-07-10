<!--
  @component
  Non-blocking top banner shown during the very first sync after login, while
  the local IndexedDB is being built from the server (paginated delta sync).

  It does NOT block the app: notes stream into the list as pages land (#356
  incremental reveal) and any already-loaded note is readable underneath. The
  banner only makes the global "first sync in progress" state visible - lifting
  the determinate counter out of the easily-missed sidebar footer - and explains
  why a few index-dependent actions (the periodic-note buttons) briefly wait.

  Mounted in +layout.svelte alongside SessionExpiredBanner, inside the measured
  div that feeds --rn-banner-h, so the 100dvh page layouts make room for it.

  Reads the stores directly (app-local component): `isInitialSync` gates it,
  `syncProgress` switches it from indeterminate to a determinate bar. A 300ms
  delay mirrors InitialSyncState's anti-flicker so a fast sync never flashes it.
-->
<script lang="ts">
  import { Loader2 } from '@lucide/svelte';
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { isInitialSync, syncProgress } from '$lib/stores/sync-status.store';
  import { t } from '$lib/stores/i18n.store';

  // Anti-flicker: only render after 300ms of continuous initial-sync, so a
  // fast (small-account) sync that settles sooner never flashes the banner.
  let showAfterDelay = $state(false);
  $effect(() => {
    if (!$isInitialSync) {
      showAfterDelay = false;
      return;
    }
    const timer = setTimeout(() => {
      showAfterDelay = true;
    }, 300);
    return () => clearTimeout(timer);
  });

  // Determinate once the notes phase reports a positive total; indeterminate
  // (spinner + sliding bar) during the pre-pull window where syncProgress is null.
  let determinate = $derived(($syncProgress?.total ?? 0) > 0);
  let pct = $derived(
    determinate ? Math.min(100, Math.round((($syncProgress!.done) / $syncProgress!.total) * 100)) : 0
  );
</script>

{#if showAfterDelay && $isInitialSync}
  <!-- slide (not a bare {#if} swap): the measured banner stack feeds
       --rn-banner-h, which the 100dvh page layouts subtract - an instant
       mount/unmount snaps the whole UI by the banner height (worst at sync
       completion, an unpredictable moment). bind:clientHeight is
       ResizeObserver-based, so the var tracks the animated height per frame
       and the layout follows the slide instead of jumping. -->
  <div
    transition:slide={{ duration: prefersReducedMotion.current ? 0 : 200 }}
    class="border-b border-primary/15 bg-primary/5"
    role="status"
    aria-live="polite"
  >
    <!-- pt: max() extends the banner under the iOS notch / Dynamic Island so the
         content starts below it (env() is 0 elsewhere), mirroring SessionExpiredBanner. -->
    <div class="px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))]">
      <div class="flex items-center gap-2.5">
        <Loader2 class="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate text-sm font-medium text-foreground">
              {$t('sync_status.initial.building')}
            </span>
            {#if determinate}
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                {$t('sync_status.initial.count', {
                  values: { done: $syncProgress!.done, total: $syncProgress!.total }
                })}
              </span>
            {/if}
          </div>
          <!-- Progress track -->
          <div
            class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-primary/15"
            role="progressbar"
            aria-label={$t('sync_status.initial.building')}
            aria-valuemin={0}
            aria-valuemax={determinate ? $syncProgress!.total : undefined}
            aria-valuenow={determinate ? $syncProgress!.done : undefined}
          >
            {#if determinate}
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style="width: {pct}%"
              ></div>
            {:else}
              <div class="rn-indeterminate h-full w-1/3 rounded-full bg-primary"></div>
            {/if}
          </div>
        </div>
      </div>
      <!-- Reassurance: this is a one-time, post-login event. Hidden on the
           narrowest screens to keep the banner a single compact line there. -->
      <p class="mt-1.5 hidden pl-[1.625rem] text-xs text-muted-foreground sm:block">
        {$t('sync_status.initial.building_hint')}
      </p>
    </div>
  </div>
{/if}

<style>
  @keyframes rn-indeterminate {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(310%);
    }
  }
  .rn-indeterminate {
    animation: rn-indeterminate 1.4s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .rn-indeterminate {
      animation-duration: 2.6s;
    }
  }
</style>
