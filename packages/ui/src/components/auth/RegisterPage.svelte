<!-- RegisterPage.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import AuthLayout from './AuthLayout.svelte';
  import RegisterForm from './RegisterForm.svelte';

  let {
    loading = false,
    error = null,
    appName = 'Reborn Apps',
    showLoginLink = true,
    loginUrl = '/login',
    showLocalModeLink = false,
    powEndpoint = '',
    termsUrl = '',
    privacyUrl = '',
    themeStorageKey = 'reborn-theme',
    header,
    onregister,
    onnavigate,
    onerror,
    onlocalmode
  } = $props<{
    loading?: boolean;
    error?: string | null;
    appName?: string;
    showLoginLink?: boolean;
    loginUrl?: string;
    /** Opt-in "use without an account" entry (local-only / offline mode). */
    showLocalModeLink?: boolean;
    powEndpoint?: string;
    termsUrl?: string;
    privacyUrl?: string;
    themeStorageKey?: string;
    header?: Snippet;
    onregister?: (detail: {
      username: string;
      password: string;
      website?: string;
      _t?: number;
      powChallenge?: string;
      powSolution?: number;
    }) => void;
    onnavigate?: (detail: { url: string }) => void;
    onerror?: (message: string) => void;
    /** Fired when the user chooses to use the app without an account. */
    onlocalmode?: () => void;
  }>();

  function handleRegister(detail: {
    username: string;
    password: string;
    website?: string;
    _t?: number;
    powChallenge?: string;
    powSolution?: number;
  }) {
    onregister?.(detail);
  }

  function navigateToLogin(event: Event) {
    event.preventDefault();
    onnavigate?.({ url: loginUrl });
  }
</script>

{#snippet extraSnippet()}
  <!-- Empty - features moved to footer -->
{/snippet}

{#snippet footerSnippet()}
  <div class="space-y-6">
    {#if showLoginLink}
      <p class="text-sm text-gray-600 dark:text-gray-400 text-center">
        {$t('auth.register.already_have_account')}
        <a
          href={loginUrl}
          class="font-medium text-primary hover:text-primary/80"
          onclick={navigateToLogin}
        >
          {$t('auth.register.sign_in')}
        </a>
      </p>
    {/if}

    {#if showLocalModeLink}
      <p class="text-sm text-gray-600 dark:text-gray-400 text-center">
        <button
          type="button"
          class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
          onclick={() => onlocalmode?.()}
        >
          {$t('auth.use_without_account')}
        </button>
      </p>
    {/if}

    <!-- Compact feature list -->
    <div class="mt-8 grid grid-cols-3 gap-4 text-center">
      <div>
        <svg
          class="h-8 w-8 text-green-500 mx-auto mb-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <p class="text-xs text-gray-600 dark:text-gray-400">
          {$t('auth.register.features.encryption')}
        </p>
      </div>
      <div>
        <svg
          class="h-8 w-8 text-green-500 mx-auto mb-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <p class="text-xs text-gray-600 dark:text-gray-400">{$t('auth.register.features.sync')}</p>
      </div>
      <div>
        <svg
          class="h-8 w-8 text-green-500 mx-auto mb-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
        <p class="text-xs text-gray-600 dark:text-gray-400">
          {$t('auth.register.features.interface')}
        </p>
      </div>
    </div>
  </div>
{/snippet}

<AuthLayout
  title={appName}
  subtitle={$t('auth.register.subtitle')}
  {header}
  footer={footerSnippet}
  {themeStorageKey}
>
  {#snippet children()}
    <RegisterForm
      {loading}
      {error}
      {powEndpoint}
      {termsUrl}
      {privacyUrl}
      onsubmit={handleRegister}
      {onerror}
      extra={extraSnippet}
    />
  {/snippet}
</AuthLayout>

<style>
  /* Custom styles if needed */
</style>
