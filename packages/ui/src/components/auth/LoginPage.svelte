<!-- LoginPage.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import AuthLayout from './AuthLayout.svelte';
  import LoginForm from './LoginForm.svelte';
  let {
    loading = false,
    error = null,
    appName = 'Reborn Apps',
    showRegisterLink = true,
    registerUrl = '/register',
    showLocalModeLink = false,
    themeStorageKey = 'reborn-theme',
    header,
    onlogin,
    onnavigate,
    onlocalmode
  } = $props<{
    loading?: boolean;
    error?: string | null;
    appName?: string;
    showRegisterLink?: boolean;
    registerUrl?: string;
    /** Opt-in "use without an account" entry (local-only / offline mode). */
    showLocalModeLink?: boolean;
    themeStorageKey?: string;
    header?: Snippet;
    onlogin?: (detail: { username: string; password: string; rememberMe: boolean }) => void;
    onnavigate?: (detail: { url: string }) => void;
    /** Fired when the user chooses to use the app without an account. */
    onlocalmode?: () => void;
  }>();

  function handleLogin(detail: { username: string; password: string; rememberMe: boolean }) {
    onlogin?.(detail);
  }

  function navigateToRegister(event: Event) {
    event.preventDefault();
    onnavigate?.({ url: registerUrl });
  }
</script>

{#snippet footerSnippet()}
  {#if showRegisterLink}
    <p class="text-sm text-muted-foreground">
      {$t('auth.login.no_account')}
      <a
        href={registerUrl}
        class="font-medium text-primary hover:text-primary/90 underline underline-offset-4"
        onclick={navigateToRegister}
      >
        {$t('auth.login.sign_up')}
      </a>
    </p>
  {/if}
  {#if showLocalModeLink}
    <p class="text-sm text-muted-foreground mt-4 border-t border-border pt-4">
      <button
        type="button"
        class="font-medium text-primary underline underline-offset-4 hover:text-primary/90"
        onclick={() => onlocalmode?.()}
      >
        {$t('auth.use_without_account')}
      </button>
    </p>
  {/if}
{/snippet}

<AuthLayout
  title={appName}
  subtitle={$t('auth.login.subtitle')}
  {header}
  footer={footerSnippet}
  {themeStorageKey}
>
  {#snippet children()}
    <LoginForm {loading} {error} onsubmit={handleLogin} />
  {/snippet}
</AuthLayout>
