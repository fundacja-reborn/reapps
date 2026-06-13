<script lang="ts">
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { goto } from '$lib/utils/navigation';
  import { page } from '$app/stores';
  import { RegisterPage } from '@reborn/ui';
  import { hashPassword, generateMasterKeyForUser, cryptoManager } from '@reborn/crypto';
  import { get } from 'svelte/store';
  import { loginInNotes } from '$lib/services/notes-auth.service';
  import {
    authStore,
    CREDENTIALS_KEY,
    ACCESS_TOKEN_KEY,
    LOCAL_MODE_KEY,
    LOCAL_USER_ID_KEY
  } from '$lib/stores/auth.store';
  import {
    markAllLocalDataPending,
    pushPendingItems,
    pullFromServer,
    refreshStoresAfterPull
  } from '$lib/services/notes-sync.service';
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

    // Upgrade path: a local-only session is creating its first account. Adopt
    // the existing local master key (wrap it with the new password) instead of
    // generating a fresh one, so offline notes - already encrypted with that
    // key - stay readable and just start syncing. See plan B1.
    const isUpgrade = get(authStore).isLocalOnly && cryptoManager.isInitialized();

    try {
      // 1. Hash password (client-side, Zero Knowledge)
      const passwordHash = await hashPassword(detail.password);

      // 2. Wrapped master key: adopt the local one on upgrade, otherwise
      //    generate a fresh key for a brand-new account.
      let encryptedMasterKey: string;
      let masterKeySalt: string;
      if (isUpgrade) {
        const localKey = cryptoManager.getCurrentKey();
        if (!localKey) throw new Error('Local master key unavailable for account upgrade');
        const wrapped = await cryptoManager.encryptMasterKey(localKey, detail.password);
        encryptedMasterKey = wrapped.encryptedMasterKey;
        masterKeySalt = wrapped.salt;
      } else {
        const generated = await generateMasterKeyForUser(detail.password);
        encryptedMasterKey = generated.encryptedMasterKey;
        masterKeySalt = generated.salt;
        // Load it so the default task list below can be encrypted.
        await cryptoManager.loadUserMasterKey(encryptedMasterKey, masterKeySalt, detail.password);
      }

      // 3. Create encrypted default task list (for re/task cross-app compatibility).
      //    The master key is in memory in both paths.
      const defaultListName = $t('registration.defaultTaskListName') || 'My Tasks';
      const nameEncrypted = await cryptoManager.encryptText(defaultListName);
      const defaultTaskList = {
        id: crypto.randomUUID(),
        name_encrypted: nameEncrypted,
        is_default: true as const
      };

      // 4. Fresh account: clear the key - loginInNotes re-loads it after auth.
      //    Upgrade: keep it loaded - it is the account's key now.
      if (!isUpgrade) {
        cryptoManager.clearMasterKey();
      }

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

      if (isUpgrade) {
        await finishLocalUpgrade(data, encryptedMasterKey, masterKeySalt);
      } else {
        // 6. Auto-login after successful registration (reuses notes-auth.service)
        const loginResult = await loginInNotes(detail.username, detail.password);
        if (loginResult.success) {
          await goto(returnTo);
        } else {
          // Registration succeeded but auto-login failed — redirect to login
          await goto('/auth/login');
        }
      }
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'An error occurred. Please try again.';
      logger.error('Registration error:', err);
    } finally {
      loading = false;
    }
  }

  /**
   * Finish a local-only -> account upgrade after a successful register call.
   * Sets the account session straight from the register response on purpose -
   * NOT loginInNotes(), which clears IndexedDB and would wipe the very local
   * notes we are adopting. The adopted master key is already in memory, so no
   * unlock is needed; we just flag the offline data for upload and converge.
   */
  async function finishLocalUpgrade(
    data: {
      user: { id: string; username: string; created_at?: string };
      access_token: string;
      encryptedMasterKey?: string;
      masterKeySalt?: string;
    },
    encryptedMasterKey: string,
    masterKeySalt: string
  ) {
    const credentials = {
      id: data.user.id,
      encrypted_master_key: data.encryptedMasterKey ?? encryptedMasterKey,
      master_key_salt: data.masterKeySalt ?? masterKeySalt,
      user_profile: data.user
    };
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);

    // Leave local-only mode: the account now owns this data.
    localStorage.removeItem(LOCAL_MODE_KEY);
    localStorage.removeItem(LOCAL_USER_ID_KEY);

    // Flag every offline-created record for upload, then hydrate the account
    // session (isAuthenticated -> true, localOnly -> false).
    await markAllLocalDataPending();
    authStore.initialize();

    // Push the adopted data, then pull to converge user_id / sync_version.
    // Best-effort: a failure here just defers to the next periodic sync.
    try {
      await pushPendingItems();
      const synced = await pullFromServer();
      if (synced) await refreshStoresAfterPull();
    } catch (err: unknown) {
      logger.warn('Initial sync after local-to-account upgrade failed:', err);
    }

    await goto(returnTo);
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
