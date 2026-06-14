<script lang="ts">
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$lib/utils/navigation';
  import { page } from '$app/stores';
  import { LoginPage } from '@reborn/ui';
  import { cryptoManager } from '@reborn/crypto';
  import { authStore } from '$lib/stores/auth.store';
  import { sessionExpired } from '$lib/stores/sync-status.store';
  import { loginInNotes } from '$lib/services/notes-auth.service';
  import { t } from '$lib/stores/i18n.store';
  import { get } from 'svelte/store';
  import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let returnTo = $state('/');

  $effect(() => {
    if (browser) {
      returnTo = new URL($page.url).searchParams.get('returnTo') ?? '/';
    }
  });

  onMount(() => {
    // Reaching the login page = no live session to expire.
    // Belt-and-suspenders cleanup so the banner never lingers when a
    // non-standard path dropped us here (cross-app logout, etc.).
    sessionExpired.set(false);
    // A local passcode wrap means there is locked local data on this origin -
    // never show the login form (its "Use without account" would regenerate the
    // master key and orphan the data). Send the user to unlock instead.
    if (cryptoManager.isLocalPasscodeLocked()) {
      goto('/auth/lock');
      return;
    }
    if ($authStore.isAuthenticated) {
      goto($authStore.hasE2E ? returnTo : '/auth/unlock');
    }
  });

  // Local-only mode: signing into an existing account runs clearAllUserData
  // (notes-auth.service), which replaces the on-device notes. Confirm before
  // that wipe so the user can export a backup instead of losing data silently.
  let confirmReplaceOpen = $state(false);
  let pendingLogin = $state<{ username: string; password: string } | null>(null);

  async function handleLogin(detail: { username: string; password: string; rememberMe: boolean }) {
    if (get(authStore).isLocalOnly) {
      pendingLogin = { username: detail.username, password: detail.password };
      confirmReplaceOpen = true;
      return;
    }
    await performLogin(detail.username, detail.password);
  }

  async function performLogin(username: string, password: string) {
    loading = true;
    error = null;

    const result = await loginInNotes(username, password);

    if (result.success) {
      await goto(returnTo);
      return;
    }

    if (result.twoFactorRequired) {
      sessionStorage.setItem('2fa_pending_password', password);
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

  async function handleLocalMode() {
    // Defense-in-depth: never start a fresh local session while a passcode wrap
    // exists (enterLocalMode would refuse, but route to unlock here so the user
    // gets the lock screen rather than an error).
    if (cryptoManager.isLocalPasscodeLocked()) {
      await goto('/auth/lock');
      return;
    }
    loading = true;
    error = null;
    const ok = await authStore.enterLocalMode();
    if (ok) {
      await goto('/');
      return;
    }
    error = $t('auth.login.errors.server_error');
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
  showLocalModeLink={true}
  themeStorageKey="reborn-notes-theme"
  onlogin={handleLogin}
  onlocalmode={handleLocalMode}
  onnavigate={(e) => {
    if (e.url === '/auth/register' && returnTo && returnTo !== '/') {
      const params = new URLSearchParams({ returnTo });
      goto(`/auth/register?${params.toString()}`);
    } else {
      goto(e.url);
    }
  }}
/>

<!-- Local-only safety: signing in replaces on-device notes - confirm first. -->
<ConfirmDialog
  bind:open={confirmReplaceOpen}
  title={$t('local_mode.replace_title')}
  description={$t('local_mode.replace_desc')}
  confirmText={$t('local_mode.replace_confirm')}
  cancelText={$t('common.cancel')}
  destructive
  onConfirm={() => {
    if (pendingLogin) return performLogin(pendingLogin.username, pendingLogin.password);
  }}
/>
