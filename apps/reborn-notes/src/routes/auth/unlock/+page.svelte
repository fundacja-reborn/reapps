<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import { cryptoManager } from '@reborn/crypto';
  import { UnlockPage, type UnlockFailure } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('UnlockRoute');

  let loading = $state(false);
  let failure = $state<UnlockFailure | null>(null);
  /** Epoch ms before which another attempt is refused (0 = none running). */
  let retryAt = $state(0);
  let username = $state('');

  onMount(async () => {
    if (!$authStore.isAuthenticated) {
      goto('/auth/login');
      return;
    }

    // A retry delay from earlier wrong passwords survives a reload - resume
    // the countdown instead of offering a form that would be refused.
    const waitMs = cryptoManager.getAccountUnlockRetryDelayMs();
    if (waitMs > 0) retryAt = Date.now() + waitMs;

    // Fast-path: shared origin IDB may already hold the master key (peer app
    // unlocked it, or cold start landed here before the layout's restore
    // settled). waitForRestore() resolves with a 5s fail-soft timeout, so the
    // password form still appears if IDB is genuinely empty/slow. With the Web
    // App Lock on there is never a key at rest; the restore then succeeds only
    // when another unlocked tab handed the key over in memory.
    await cryptoManager.waitForRestore();
    if (cryptoManager.isInitialized()) {
      logger.info('Master key found in shared IDB - skipping password prompt');
      authStore.markE2EUnlocked();
      goto('/');
      return;
    }

    if ($authStore.hasE2E) {
      goto('/');
      return;
    }
    username = $authStore.username ?? '';
  });

  async function handleUnlock(password: string) {
    loading = true;
    failure = null;

    try {
      const outcome = await authStore.unlockWithPassword(password);

      if (outcome.kind === 'ok') {
        logger.info('E2E unlocked successfully');
        await goto('/');
        return;
      }

      failure = outcome;
      if (outcome.kind === 'invalid_password' || outcome.kind === 'throttled') {
        retryAt = outcome.retryAfterMs > 0 ? Date.now() + outcome.retryAfterMs : 0;
      }
    } catch (err: unknown) {
      logger.error('Unlock error:', err);
      failure = { kind: 'error' };
    } finally {
      loading = false;
    }
  }

  async function handleLogout() {
    loading = true;
    try {
      // logout() ends in a hard redirect to the login page.
      await authStore.logout();
    } catch (err: unknown) {
      logger.error('Logout error:', err);
      failure = { kind: 'error' };
      loading = false;
    }
  }
</script>

{#snippet logoHeader()}
  <img src="{base}/logo-black.svg" alt="re/notes" class="h-6 w-auto block dark:hidden" />
  <img
    src="{base}/logo-white.svg"
    alt="re/notes"
    class="h-6 w-auto hidden dark:block dark:opacity-80"
  />
{/snippet}

<UnlockPage
  {username}
  {loading}
  {failure}
  {retryAt}
  header={logoHeader}
  onUnlock={handleUnlock}
  onLogout={handleLogout}
/>
