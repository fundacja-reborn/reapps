<!-- UnlockE2E.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '@reborn/i18n';
  import { formatUnlockCountdown, type UnlockFailure } from './unlock-types';

  let {
    username = '',
    loading = false,
    failure = null,
    retryAt = 0,
    extra,
    onUnlock,
    onLogout
  } = $props<{
    username?: string;
    loading?: boolean;
    /** Why the last attempt failed, or null. */
    failure?: UnlockFailure | null;
    /** Epoch ms before which another attempt is refused (0 = no delay running). */
    retryAt?: number;
    extra?: Snippet;
    onUnlock?: (password: string) => void;
    onLogout?: () => void;
  }>();

  let password = $state('');
  let showPassword = $state(false);
  /** Milliseconds left of the retry delay; drives the countdown. */
  let waitMs = $state(0);

  // Count the retry delay down. Wrong passwords no longer sign the user out -
  // they open a growing delay instead, and the form stays disabled meanwhile.
  $effect(() => {
    const until = retryAt;
    // `waitMs` is only written here, never read: reading it would make the
    // effect depend on its own output and restart the interval on every tick.
    const remaining = () => Math.max(0, until - Date.now());
    const initial = remaining();
    waitMs = initial;
    if (initial === 0) return;
    const handle = setInterval(() => {
      const left = remaining();
      waitMs = left;
      if (left === 0) clearInterval(handle);
    }, 500);
    return () => clearInterval(handle);
  });

  const waiting = $derived(waitMs > 0);

  const errorText = $derived.by(() => {
    if (!failure) return null;
    switch (failure.kind) {
      case 'invalid_password':
        return failure.offline
          ? $t('auth.unlock.error_wrong_password_offline')
          : $t('auth.unlock.error_wrong_password');
      case 'server_locked':
        return $t('auth.session.error_locked', { values: { seconds: failure.retryAfter } });
      case 'throttled':
        // The countdown below says everything there is to say.
        return null;
      default:
        return $t('auth.unlock.error_unknown');
    }
  });

  function handleSubmit(event: Event) {
    event.preventDefault();

    if (!password || waiting) {
      return;
    }

    onUnlock?.(password);
  }

  function handleLogout() {
    onLogout?.();
  }

  function togglePasswordVisibility() {
    showPassword = !showPassword;
  }
</script>

<div class="space-y-6">
  <div class="text-center">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
      {$t('auth.unlock.title')}
    </h2>
    <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
      {$t('auth.unlock.description')}
    </p>
  </div>

  <form onsubmit={handleSubmit} class="space-y-6">
    {#if errorText || waiting}
      <div
        role="alert"
        class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded relative"
      >
        {#if errorText}
          <p>{errorText}</p>
        {/if}
        {#if waiting}
          <p class={errorText ? 'mt-1 text-sm' : ''}>
            {$t('auth.unlock.error_throttled', {
              values: { time: formatUnlockCountdown(waitMs) }
            })}
          </p>
        {/if}
      </div>
    {/if}

    <div>
      <label
        for="unlock-username"
        class="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {$t('auth.unlock.username_label')}
      </label>
      <div class="mt-1">
        <input
          id="unlock-username"
          name="username"
          type="text"
          autocomplete="username"
          value={username}
          readonly
          disabled
          class="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 cursor-not-allowed opacity-75 sm:text-sm"
        />
      </div>
    </div>

    <div>
      <label
        for="unlock-password"
        class="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {$t('auth.unlock.password_label')}
      </label>
      <div class="mt-1 relative">
        <input
          id="unlock-password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          autocomplete="current-password"
          required
          bind:value={password}
          disabled={loading}
          placeholder={$t('auth.unlock.password_placeholder')}
          class="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-ring focus:border-ring dark:bg-gray-800 dark:text-gray-100 sm:text-sm"
        />
        <button
          type="button"
          class="absolute inset-y-0 inset-e-0 pe-3 flex items-center text-sm leading-5"
          onclick={togglePasswordVisibility}
          aria-label={showPassword
            ? $t('auth.unlock.hide_password')
            : $t('auth.unlock.show_password')}
        >
          {#if showPassword}
            <svg
              class="h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
          {:else}
            <svg
              class="h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          {/if}
        </button>
      </div>
    </div>

    <div class="space-y-3">
      <button
        type="submit"
        disabled={loading || !password || waiting}
        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {#if loading}
          <svg
            class="animate-spin -ms-1 me-3 h-5 w-5 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {$t('auth.unlock.unlocking')}
        {:else}
          {$t('auth.unlock.submit')}
        {/if}
      </button>

      <button
        type="button"
        onclick={handleLogout}
        disabled={loading}
        class="w-full flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {$t('auth.unlock.sign_out')}
      </button>
    </div>
  </form>

  {#if extra}
    <div>
      {@render extra()}
    </div>
  {/if}

  <div class="text-center">
    <p class="text-xs text-gray-500 dark:text-gray-400">
      {$t('auth.unlock.e2e_note')}
    </p>
  </div>
</div>
