<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { page } from '$app/stores';
  import {
    AuthLayout,
    Button,
    Input,
    Label,
    Alert,
    AlertDescription,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '@reborn/ui';
  import { Eye, EyeOff, Lock } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { cryptoManager, LocalPasscodeThrottledError } from '@reborn/crypto';
  import { authStore, LOCAL_MODE_KEY, LOCAL_USER_ID_KEY } from '$lib/stores/auth.store';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('LockRoute');

  let passcode = $state('');
  let showPasscode = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let resetOpen = $state(false);
  let resetting = $state(false);
  let isRedirecting = false;

  // Failure-throttle countdown (audit 012 N6): after repeated wrong passcodes
  // the crypto layer refuses attempts for a growing window - surface it as a
  // ticking "try again in m:ss" instead of a misleading "wrong passcode".
  let retryDelayMs = $state(0);
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const retryTimeLabel = $derived.by(() => {
    const total = Math.ceil(retryDelayMs / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  });

  function syncRetryDelay() {
    retryDelayMs = cryptoManager.getLocalPasscodeRetryDelayMs();
    if (retryDelayMs <= 0 && retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }

  function watchRetryDelay() {
    syncRetryDelay();
    if (retryDelayMs > 0 && !retryTimer) {
      retryTimer = setInterval(syncRetryDelay, 500);
    }
  }

  const returnTo = $derived.by(() => $page.url.searchParams.get('returnTo') || '/');

  // Nothing to unlock (no passcode set) or the key is already in memory → leave.
  onMount(() => {
    if (!cryptoManager.isLocalPasscodeEnabled() || cryptoManager.isInitialized()) {
      isRedirecting = true;
      goto(returnTo);
    }
    // A reload inside an open throttle window resumes the countdown.
    watchRetryDelay();
    return () => {
      if (retryTimer) clearInterval(retryTimer);
    };
  });

  async function handleUnlock(event: Event) {
    event.preventDefault();
    if (!passcode || loading || retryDelayMs > 0) return;
    loading = true;
    error = null;
    try {
      const ok = await authStore.unlockLocalPasscode(passcode);
      if (ok) {
        isRedirecting = true;
        await goto(returnTo);
      } else {
        error = $t('local_mode.passcode.wrong');
        passcode = '';
        watchRetryDelay();
      }
    } catch (err: unknown) {
      if (err instanceof LocalPasscodeThrottledError) {
        watchRetryDelay();
      } else {
        logger.error('Passcode unlock failed:', err);
        error = $t('local_mode.passcode.wrong');
      }
    } finally {
      loading = false;
    }
  }

  async function handleReset() {
    resetting = true;
    // The wrapped data is unrecoverable without the passcode - wiping is the
    // only way out. forget → clear data → clear markers → hard redirect.
    cryptoManager.forgetLocalPasscode();
    try {
      const { clearAllUserData } = await import('@reborn/storage');
      await clearAllUserData();
    } catch (err: unknown) {
      logger.error('Failed to wipe local data on passcode reset:', err);
    }
    // Auto-backup config + recovery phrase are keyed by the local user id -
    // wipe them while the marker below still resolves that id.
    try {
      const { clearAutoBackupState } = await import('$lib/services/auto-backup');
      await clearAutoBackupState();
    } catch (err: unknown) {
      logger.error('Failed to clear auto-backup state on passcode reset:', err);
    }
    localStorage.removeItem(LOCAL_MODE_KEY);
    localStorage.removeItem(LOCAL_USER_ID_KEY);
    // Hard redirect guarantees all in-memory state is dropped.
    window.location.href = `${base}/auth/login`;
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

<AuthLayout header={logoHeader}>
  <div class="space-y-6">
    <div class="text-center">
      <div
        class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"
      >
        <Lock class="h-6 w-6 text-primary" />
      </div>
      <h2 class="text-lg font-semibold text-foreground">
        {$t('local_mode.passcode.locked_title')}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">{$t('local_mode.passcode.locked_desc')}</p>
    </div>

    <form onsubmit={handleUnlock} class="space-y-4">
      {#if retryDelayMs > 0}
        <Alert variant="destructive">
          <AlertDescription>
            {$t('local_mode.passcode.throttled', { values: { time: retryTimeLabel } })}
          </AlertDescription>
        </Alert>
      {:else if error}
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      {/if}

      <div class="space-y-2">
        <Label for="passcode">{$t('local_mode.passcode.input_label')}</Label>
        <div class="relative">
          <Input
            id="passcode"
            type={showPasscode ? 'text' : 'password'}
            bind:value={passcode}
            autocomplete="off"
            disabled={loading}
            placeholder={$t('local_mode.passcode.input_placeholder')}
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            onclick={() => (showPasscode = !showPasscode)}
            aria-label={$t('local_mode.passcode.toggle_visibility')}
          >
            {#if showPasscode}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={loading || !passcode || retryDelayMs > 0} class="w-full">
        {loading
          ? $t('local_mode.passcode.unlocking')
          : $t('local_mode.passcode.unlock_cta')}
      </Button>
    </form>

    <div class="text-center">
      <button
        type="button"
        class="text-sm text-muted-foreground underline hover:text-foreground"
        onclick={() => (resetOpen = true)}
      >
        {$t('local_mode.passcode.forgot')}
      </button>
    </div>
  </div>
</AuthLayout>

<Dialog bind:open={resetOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$t('local_mode.passcode.reset_title')}</DialogTitle>
      <DialogDescription>{$t('local_mode.passcode.reset_desc')}</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onclick={() => (resetOpen = false)} disabled={resetting}>
        {$t('common.cancel')}
      </Button>
      <Button variant="destructive" onclick={handleReset} disabled={resetting}>
        {$t('local_mode.passcode.reset_confirm')}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
