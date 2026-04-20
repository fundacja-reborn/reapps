<script lang="ts">
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { page } from '$app/stores';
  import { LoginPage } from '@reborn/ui';
  import { authStore } from '$lib/stores/auth.store';
  import { loginInNotes } from '$lib/services/notes-auth.service';
  import { t } from '$lib/stores/i18n.store';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let returnTo = $state('/');

  $effect(() => {
    if (browser) {
      returnTo = new URL($page.url).searchParams.get('returnTo') ?? '/';
    }
  });

  onMount(() => {
    if ($authStore.isAuthenticated) {
      goto($authStore.hasE2E ? returnTo : '/auth/unlock');
    }
  });

  async function handleLogin(detail: { username: string; password: string; rememberMe: boolean }) {
    loading = true;
    error = null;

    const result = await loginInNotes(detail.username, detail.password);

    if (result.success) {
      await goto(returnTo);
      return;
    }

    if (result.twoFactorRequired) {
      sessionStorage.setItem('2fa_pending_password', detail.password);
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp variable
      const params = new URLSearchParams({ userId: result.userId ?? '', returnTo });
      if (result.encryptedMasterKey) params.set('emk', result.encryptedMasterKey);
      if (result.masterKeySalt) params.set('ms', result.masterKeySalt);
      await goto(`/auth/2fa?${params.toString()}`);
      return;
    }

    error = result.message ?? $t('auth.login.errors.invalid_credentials');
    loading = false;
  }
</script>

<svelte:head>
  <title>{$t('auth.login.title')} — re/notes</title>
</svelte:head>

{#snippet logoHeader()}
  <img src="{base}/logo-black.svg" alt="re/notes" class="h-6 w-auto block dark:hidden" />
  <img
    src="{base}/logo-white.svg"
    alt="re/notes"
    class="h-6 w-auto hidden dark:block dark:opacity-80"
  />
{/snippet}

<LoginPage
  {loading}
  {error}
  appName="re/notes"
  header={logoHeader}
  showRegisterLink={true}
  registerUrl="/auth/register"
  themeStorageKey="reborn-notes-theme"
  onlogin={handleLogin}
  onnavigate={(e) => {
    if (e.url === '/auth/register' && returnTo && returnTo !== '/') {
      const params = new URLSearchParams({ returnTo });
      goto(`/auth/register?${params.toString()}`);
    } else {
      goto(e.url);
    }
  }}
/>
