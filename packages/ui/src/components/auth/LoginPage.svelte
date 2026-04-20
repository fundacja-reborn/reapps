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
    themeStorageKey = 'reborn-theme',
    header,
    onlogin,
    onnavigate
  } = $props<{
    loading?: boolean;
    error?: string | null;
    appName?: string;
    showRegisterLink?: boolean;
    registerUrl?: string;
    themeStorageKey?: string;
    header?: Snippet;
    onlogin?: (detail: { username: string; password: string; rememberMe: boolean }) => void;
    onnavigate?: (detail: { url: string }) => void;
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
