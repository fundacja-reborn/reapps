<!-- LoginForm.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { Button } from '../button';
  import { Input } from '../input';
  import { Label } from '../label';
  import { Checkbox } from '../checkbox';
  import { Alert } from '../alert';
  import { Eye as EyeIcon, EyeOff as EyeOffIcon } from '@lucide/svelte';
  import { untrack } from 'svelte';

  let {
    loading = false,
    error = null,
    initialUsername = '',
    rememberMe = false,
    extra,
    onsubmit
  } = $props<{
    loading?: boolean;
    error?: string | null;
    initialUsername?: string;
    rememberMe?: boolean;
    extra?: Snippet;
    onsubmit?: (detail: { username: string; password: string; rememberMe: boolean }) => void;
  }>();

  let username = $state(untrack(() => initialUsername));
  let password = $state('');
  let showPassword = $state(false);
  let remember = $state(untrack(() => rememberMe));
  let submitAttempted = $state(false);
  let touched = $state({ username: false, password: false });

  const usernameError = $derived.by((): string | null => {
    if (!touched.username && !submitAttempted) return null;
    if (!username.trim()) return $t('auth.login.username_required');
    return null;
  });

  const passwordError = $derived.by((): string | null => {
    if (!touched.password && !submitAttempted) return null;
    if (!password) return $t('auth.login.password_required');
    return null;
  });

  function handleSubmit(event: Event) {
    event.preventDefault();
    submitAttempted = true;

    if (!username.trim() || !password) {
      return;
    }

    onsubmit?.({
      username: username.trim(),
      password,
      rememberMe: remember
    });
  }

  function togglePasswordVisibility() {
    showPassword = !showPassword;
  }
</script>

<form onsubmit={handleSubmit} class="space-y-6">
  {#if error}
    <Alert variant="destructive">
      {error}
    </Alert>
  {/if}

  <div class="space-y-1">
    <Label for="username">{$t('auth.login.username_label')}</Label>
    <Input
      id="username"
      name="username"
      type="text"
      autocomplete="username"
      bind:value={username}
      disabled={loading}
      placeholder={$t('auth.login.username_placeholder')}
      onblur={() => (touched.username = true)}
      aria-describedby={usernameError ? 'login-username-error' : undefined}
      aria-invalid={usernameError ? 'true' : undefined}
      class={usernameError ? 'border-destructive focus-visible:ring-destructive' : ''}
    />
    {#if usernameError}
      <p id="login-username-error" class="text-xs text-destructive">
        {usernameError}
      </p>
    {/if}
  </div>

  <div class="space-y-1">
    <Label for="password">{$t('auth.login.password_label')}</Label>
    <div class="relative">
      <Input
        id="password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        autocomplete="current-password"
        bind:value={password}
        disabled={loading}
        placeholder={$t('auth.login.password_placeholder')}
        onblur={() => (touched.password = true)}
        aria-describedby={passwordError ? 'login-password-error' : undefined}
        aria-invalid={passwordError ? 'true' : undefined}
        class="pr-10 {passwordError ? 'border-destructive focus-visible:ring-destructive' : ''}"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
        onclick={togglePasswordVisibility}
        tabindex={-1}
      >
        {#if showPassword}
          <EyeOffIcon class="h-4 w-4 text-muted-foreground" />
        {:else}
          <EyeIcon class="h-4 w-4 text-muted-foreground" />
        {/if}
      </Button>
    </div>
    {#if passwordError}
      <p id="login-password-error" class="text-xs text-destructive">
        {passwordError}
      </p>
    {/if}
  </div>

  <div class="flex items-center space-x-2">
    <Checkbox id="remember-me" bind:checked={remember} disabled={loading} />
    <Label for="remember-me" class="text-sm font-normal cursor-pointer">
      {$t('auth.login.remember_me')}
    </Label>
  </div>

  <Button type="submit" disabled={loading || !username.trim() || !password} class="w-full">
    {#if loading}
      <span class="mr-2">
        <svg
          class="animate-spin h-4 w-4"
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
      </span>
      {$t('auth.login.logging_in')}
    {:else}
      {$t('auth.login.submit')}
    {/if}
  </Button>

  {#if extra}
    <div>
      {@render extra()}
    </div>
  {/if}
</form>
