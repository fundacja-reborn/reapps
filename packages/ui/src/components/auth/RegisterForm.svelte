<!-- RegisterForm.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import PasswordStrength from './PasswordStrength.svelte';

  let {
    loading = false,
    error = null,
    extra,
    powEndpoint = '',
    termsUrl = '',
    privacyUrl = '',
    onsubmit,
    onerror
  } = $props<{
    loading?: boolean;
    error?: string | null;
    extra?: Snippet;
    powEndpoint?: string;
    termsUrl?: string;
    privacyUrl?: string;
    onsubmit?: (detail: {
      username: string;
      password: string;
      website?: string;
      _t?: number;
      powChallenge?: string;
      powSolution?: number;
    }) => void;
    onerror?: (message: string) => void;
  }>();

  let username = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let showConfirmPassword = $state(false);
  let submitAttempted = $state(false);
  let touched = $state({ username: false, password: false, confirmPassword: false });
  let honeypot = $state('');
  let solving = $state(false);
  const formLoadedAt = Date.now();

  const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

  const usernameError = $derived.by((): string | null => {
    if (!touched.username && !submitAttempted) return null;
    if (!username.trim()) return $t('auth.register.username_required');
    if (username.trim().length < 3) return $t('auth.register.username_min_length');
    if (username.trim().length > 50) return $t('auth.register.username_max_length');
    if (!USERNAME_REGEX.test(username.trim())) return $t('auth.register.username_invalid_chars');
    return null;
  });

  const passwordError = $derived.by((): string | null => {
    if (!touched.password && !submitAttempted) return null;
    if (!password) return $t('auth.register.password_required');
    if (password.length < 8) return $t('auth.register.password_min_length');
    return null;
  });

  const confirmPasswordError = $derived.by((): string | null => {
    if (!touched.confirmPassword && !submitAttempted) return null;
    if (!confirmPassword) return $t('auth.register.confirm_required');
    if (password !== confirmPassword) return $t('auth.register.passwords_no_match');
    return null;
  });

  const passwordsMatch = $derived(password === confirmPassword);
  const canSubmit = $derived(
    username.trim().length >= 3 &&
      username.trim().length <= 50 &&
      USERNAME_REGEX.test(username.trim()) &&
      password.length >= 8 &&
      confirmPassword.length > 0 &&
      passwordsMatch
  );

  function handleSubmit(event: Event) {
    event.preventDefault();
    submitAttempted = true;

    if (!canSubmit || solving) {
      return;
    }

    if (powEndpoint) {
      // Solve PoW challenge before submitting
      solving = true;
      solvePowAndSubmit();
    } else {
      // No PoW endpoint configured — submit directly with honeypot + timing
      onsubmit?.({
        username: username.trim(),
        password,
        website: honeypot,
        _t: formLoadedAt
      });
    }
  }

  async function solvePowAndSubmit() {
    try {
      // 1. Fetch PoW challenge from server
      const res = await fetch(powEndpoint);
      if (!res.ok) {
        solving = false;
        onerror?.($t('auth.register.pow_error'));
        return;
      }
      const { data: challenge } = await res.json();

      // 2. Dynamically import solver (client-only, keeps bundle small)
      const { solvePowChallenge } = await import('@reborn/auth');
      const solution = await solvePowChallenge(challenge);

      solving = false;

      // 3. Submit with all protection data
      onsubmit?.({
        username: username.trim(),
        password,
        website: honeypot,
        _t: formLoadedAt,
        powChallenge: JSON.stringify(challenge),
        powSolution: solution
      });
    } catch {
      solving = false;
      onerror?.($t('auth.register.pow_error'));
    }
  }

  function togglePasswordVisibility() {
    showPassword = !showPassword;
  }

  function toggleConfirmPasswordVisibility() {
    showConfirmPassword = !showConfirmPassword;
  }
</script>

<form onsubmit={handleSubmit} class="space-y-6">
  {#if error}
    <div
      class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm"
      role="alert"
    >
      {error}
    </div>
  {/if}

  <!-- Honeypot field — invisible to humans, filled by bots -->
  <div style="position: absolute; left: -9999px; top: -9999px;" aria-hidden="true">
    <label for="website">Website</label>
    <input
      id="website"
      name="website"
      type="text"
      tabindex="-1"
      autocomplete="off"
      bind:value={honeypot}
    />
  </div>

  <div>
    <label for="username" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {$t('auth.register.username_label')}
    </label>
    <div class="mt-1">
      <input
        id="username"
        name="username"
        type="text"
        autocomplete="username"
        bind:value={username}
        disabled={loading}
        placeholder={$t('auth.register.username_placeholder')}
        onblur={() => (touched.username = true)}
        aria-describedby={usernameError ? 'username-error' : undefined}
        aria-invalid={usernameError ? 'true' : undefined}
        class="appearance-none block w-full px-3 py-2 border {usernameError
          ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
          : 'border-gray-300 focus:ring-ring focus:border-primary'} rounded-md shadow-sm placeholder-gray-400 focus:outline-none sm:text-sm"
      />
    </div>
    {#if usernameError}
      <p id="username-error" class="mt-1 text-xs text-red-600 dark:text-red-400">
        {usernameError}
      </p>
    {:else}
      <p class="mt-1 text-xs text-gray-500">{$t('auth.register.username_hint')}</p>
    {/if}
  </div>

  <div>
    <label for="password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {$t('auth.register.password_label')}
    </label>
    <div class="mt-1 relative">
      <input
        id="password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autocomplete="new-password"
        bind:value={password}
        disabled={loading}
        placeholder={$t('auth.register.password_placeholder')}
        onblur={() => (touched.password = true)}
        aria-describedby={passwordError ? 'password-error' : undefined}
        aria-invalid={passwordError ? 'true' : undefined}
        class="appearance-none block w-full px-3 py-2 border {passwordError
          ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
          : 'border-gray-300 focus:ring-ring focus:border-primary'} rounded-md shadow-sm placeholder-gray-400 focus:outline-none sm:text-sm"
      />
      <button
        type="button"
        class="absolute inset-y-0 right-0 pr-3 flex items-center text-sm leading-5"
        onclick={togglePasswordVisibility}
        tabindex="-1"
      >
        {#if showPassword}
          <svg class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
            />
          </svg>
        {:else}
          <svg class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    {#if passwordError}
      <p id="password-error" class="mt-1 text-xs text-red-600 dark:text-red-400">
        {passwordError}
      </p>
    {/if}
    {#if password}
      <div class="mt-2">
        <PasswordStrength {password} />
      </div>
    {/if}
  </div>

  <div>
    <label for="confirmPassword" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {$t('auth.register.confirm_password_label')}
    </label>
    <div class="mt-1 relative">
      <input
        id="confirmPassword"
        name="confirmPassword"
        type={showConfirmPassword ? 'text' : 'password'}
        autocomplete="new-password"
        bind:value={confirmPassword}
        disabled={loading}
        placeholder={$t('auth.register.confirm_password_placeholder')}
        onblur={() => (touched.confirmPassword = true)}
        aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
        aria-invalid={confirmPasswordError ? 'true' : undefined}
        class="appearance-none block w-full px-3 py-2 border {confirmPasswordError
          ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
          : 'border-gray-300 focus:ring-ring focus:border-primary'} rounded-md shadow-sm placeholder-gray-400 focus:outline-none sm:text-sm"
      />
      <button
        type="button"
        class="absolute inset-y-0 right-0 pr-3 flex items-center text-sm leading-5"
        onclick={toggleConfirmPasswordVisibility}
        tabindex="-1"
      >
        {#if showConfirmPassword}
          <svg class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
            />
          </svg>
        {:else}
          <svg class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    {#if confirmPasswordError}
      <p id="confirm-password-error" class="mt-1 text-xs text-red-600 dark:text-red-400">
        {confirmPasswordError}
      </p>
    {/if}
  </div>

  <div class="space-y-4">
    <div class="relative">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t border-gray-300 dark:border-gray-600"></div>
      </div>
      <div class="relative flex justify-center text-sm">
        <span class="px-2 bg-white dark:bg-gray-900 text-gray-500">
          {$t('auth.register.terms_text')}
          {#if termsUrl}
            <a
              href={termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:text-primary/80 underline underline-offset-2"
              >{$t('auth.register.terms_link')}</a
            >
          {:else}
            {$t('auth.register.terms_link')}
          {/if}
          {$t('auth.register.terms_and')}
          {#if privacyUrl}
            <a
              href={privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:text-primary/80 underline underline-offset-2"
              >{$t('auth.register.privacy_link')}</a
            >
          {:else}
            {$t('auth.register.privacy_link')}
          {/if}
        </span>
      </div>
    </div>

    <button
      type="submit"
      disabled={loading || solving || !canSubmit}
      class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {#if solving}
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
        {$t('auth.register.verifying')}
      {:else if loading}
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
        {$t('auth.register.creating_account')}
      {:else}
        {$t('auth.register.submit')}
      {/if}
    </button>
  </div>

  {#if extra}
    <div>
      {@render extra()}
    </div>
  {/if}
</form>
