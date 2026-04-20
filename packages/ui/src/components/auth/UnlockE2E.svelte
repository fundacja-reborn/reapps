<!-- UnlockE2E.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    username = '',
    loading = false,
    error = null,
    attemptsRemaining,
    extra,
    onUnlock,
    onLogout
  } = $props<{
    username?: string;
    loading?: boolean;
    error?: string | null;
    attemptsRemaining?: number;
    extra?: Snippet;
    onUnlock?: (password: string) => void;
    onLogout?: () => void;
  }>();

  let password = $state('');
  let showPassword = $state(false);

  function handleSubmit(event: Event) {
    event.preventDefault();

    if (!password) {
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
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Unlock Your Data</h2>
    <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
      Your session is active but your encrypted data needs to be unlocked
    </p>
  </div>

  <form onsubmit={handleSubmit} class="space-y-6">
    {#if error}
      <div
        class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded relative"
      >
        <p>{error}</p>
        {#if attemptsRemaining !== undefined && attemptsRemaining > 0}
          <p class="mt-1 text-sm">
            {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
          </p>
        {/if}
      </div>
    {/if}

    <div>
      <label
        for="unlock-username"
        class="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        Username
      </label>
      <div class="mt-1">
        <input
          id="unlock-username"
          type="text"
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
        Password
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
          placeholder="Enter your password to unlock"
          class="appearance-none block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-ring focus:border-ring dark:bg-gray-800 dark:text-gray-100 sm:text-sm"
        />
        <button
          type="button"
          class="absolute inset-y-0 right-0 pr-3 flex items-center text-sm leading-5"
          onclick={togglePasswordVisibility}
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
        disabled={loading || !password}
        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {#if loading}
          <svg
            class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
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
          Unlocking...
        {:else}
          Unlock
        {/if}
      </button>

      <button
        type="button"
        onclick={handleLogout}
        disabled={loading}
        class="w-full flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Sign Out
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
      Your data is encrypted end-to-end. We never see your password or unencrypted data.
    </p>
  </div>
</div>
