<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import { UnlockPage } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('UnlockRoute');
  const MAX_ATTEMPTS = 5;

  let loading = $state(false);
  let error = $state<string | null>(null);
  let attemptsRemaining = $state<number | undefined>(undefined);
  let username = $state('');

  onMount(() => {
    if (!$authStore.isAuthenticated) {
      goto('/auth/login');
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
    error = null;

    try {
      const success = await authStore.unlockE2E(password);

      if (success) {
        logger.info('E2E unlocked successfully');
        await goto('/');
      } else {
        const remaining = (attemptsRemaining ?? MAX_ATTEMPTS) - 1;
        attemptsRemaining = remaining;

        if (remaining <= 0) {
          authStore.logout();
          await goto('/auth/login');
        } else {
          error = `Wrong password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`;
        }
      }
    } catch (err: unknown) {
      logger.error('Unlock error:', err);
      error = err instanceof Error ? err.message : 'Failed to unlock';
    } finally {
      loading = false;
    }
  }

  async function handleLogout() {
    loading = true;
    try {
      authStore.logout();
      await goto('/auth/login');
    } catch (err: unknown) {
      logger.error('Logout error:', err);
      error = err instanceof Error ? err.message : 'Failed to logout';
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
  {error}
  {attemptsRemaining}
  header={logoHeader}
  onUnlock={handleUnlock}
  onLogout={handleLogout}
>
  {#snippet footer()}
    <p class="text-sm text-gray-600 dark:text-gray-400">
      Having trouble? You can also
      <button
        onclick={handleLogout}
        class="font-medium text-primary hover:text-primary/80 underline"
      >
        sign out and log in again
      </button>
    </p>
  {/snippet}
</UnlockPage>
