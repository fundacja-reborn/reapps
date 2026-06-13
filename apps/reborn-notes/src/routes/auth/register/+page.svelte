<script lang="ts">
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { goto } from '$lib/utils/navigation';
  import { page } from '$app/stores';
  import { RegisterPage } from '@reborn/ui';
  import { hashPassword, generateMasterKeyForUser, cryptoManager } from '@reborn/crypto';
  import { loginInNotes } from '$lib/services/notes-auth.service';
  import { authStore } from '$lib/stores/auth.store';
  import { t } from '$lib/stores/i18n.store';
  import { locale } from 'svelte-i18n';
  import { API_BASE } from '$lib/utils/api-base';
  import { PUBLIC_SITE_URL } from '$env/static/public';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('notes:register');

  let returnTo = $state('/');
  let loading = $state(false);
  let error = $state<string | null>(null);

  const siteUrl = PUBLIC_SITE_URL || '';
  const termsUrl = $derived(siteUrl ? `${siteUrl}${$locale !== 'en' ? '/' + $locale : ''}/terms` : '');
  const privacyUrl = $derived(siteUrl ? `${siteUrl}${$locale !== 'en' ? '/' + $locale : ''}/privacy` : '');

  $effect(() => {
    if (browser) {
      returnTo = new URL($page.url).searchParams.get('returnTo') ?? '/';
    }
  });

  async function handleRegister(detail: {
    username: string;
    password: string;
    website?: string;
    _t?: number;
    powChallenge?: string;
    powSolution?: number;
  }) {
    loading = true;
    error = null;

    try {
      // 1. Hash password + generate encrypted master key (client-side, Zero Knowledge)
      const passwordHash = await hashPassword(detail.password);
      const { encryptedMasterKey, salt: masterKeySalt } = await generateMasterKeyForUser(
        detail.password
      );

      // 2. Load master key into CryptoManager to encrypt default task list name
      await cryptoManager.loadUserMasterKey(encryptedMasterKey, masterKeySalt, detail.password);

      // 3. Create encrypted default task list (for re/task cross-app compatibility)
      const defaultListName = $t('registration.defaultTaskListName') || 'My Tasks';
      const nameEncrypted = await cryptoManager.encryptText(defaultListName);
      const defaultTaskList = {
        id: crypto.randomUUID(),
        name_encrypted: nameEncrypted,
        is_default: true as const
      };

      // 4. Clear master key — loginInNotes will re-load it after auth
      cryptoManager.clearMasterKey();

      // 5. Register via API with bot protection data + default task list
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: detail.username,
          passwordHash,
          encryptedMasterKey,
          masterKeySalt,
          website: detail.website,
          _t: detail._t,
          powChallenge: detail.powChallenge,
          powSolution: detail.powSolution,
          defaultTaskList
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        error = data.error || 'Registration failed';
        return;
      }

      // 6. Auto-login after successful registration (reuses notes-auth.service)
      const loginResult = await loginInNotes(detail.username, detail.password);

      if (loginResult.success) {
        await goto(returnTo);
      } else {
        // Registration succeeded but auto-login failed — redirect to login
        await goto('/auth/login');
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'An error occurred. Please try again.';
      logger.error('Registration error:', err);
    } finally {
      loading = false;
    }
  }

  async function handleLocalMode() {
    loading = true;
    error = null;
    const ok = await authStore.enterLocalMode();
    if (ok) {
      await goto('/');
      return;
    }
    error = $t('auth.register.errors.server_error');
    loading = false;
  }
</script>

<svelte:head>
  <title>{$t('auth.register.title')} — re/notes</title>
</svelte:head>

{#snippet logoHeader()}
  <img src="{base}/logo-black.svg" alt="re/notes" class="h-6 w-auto block dark:hidden" />
  <img
    src="{base}/logo-white.svg"
    alt="re/notes"
    class="h-6 w-auto hidden dark:block dark:opacity-80"
  />
{/snippet}

<RegisterPage
  {loading}
  {error}
  appName="re/notes"
  header={logoHeader}
  showLoginLink={true}
  loginUrl="/auth/login"
  showLocalModeLink={true}
  powEndpoint={`${API_BASE}/auth/pow`}
  {termsUrl}
  {privacyUrl}
  themeStorageKey="reborn-notes-theme"
  onregister={handleRegister}
  onlocalmode={handleLocalMode}
  onerror={(msg) => {
    error = msg;
  }}
  onnavigate={(e) => {
    if (e.url === '/auth/login' && returnTo && returnTo !== '/') {
      const params = new URLSearchParams({ returnTo });
      goto(`/auth/login?${params.toString()}`);
    } else {
      goto(e.url);
    }
  }}
/>
