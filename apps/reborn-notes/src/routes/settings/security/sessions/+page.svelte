<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/utils/auth-fetch';
  import { Monitor, LogOut, RefreshCw, AlertTriangle, X } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { authStore } from '$lib/stores/auth.store';
  import { sessionExpired } from '$lib/stores/sync-status.store';
  import { SettingsLayout, Button, Alert, AlertDescription, Card, CardContent } from '@reborn/ui';
  import { toast } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';
  import { cryptoManager } from '@reborn/crypto';

  const logger = createLogger('Notes-SessionsPage');

  type Session = {
    id: string;
    login_at: string;
    expires_at: string;
    device_info_encrypted: string | null;
  };

  let isLoading = $state(true);
  let sessions = $state<Session[]>([]);
  let currentSessionId = $state<string | null>(null);
  let revoking = $state<string | null>(null);
  let revokingAll = $state(false);
  let isLoggingOut = $state(false);
  let showLogoutAllConfirm = $state(false);
  let error = $state<string | null>(null);
  let decryptedDeviceNames = $state<Record<string, string>>({});

  const currentSession = $derived(sessions.find((s) => s.id === currentSessionId));
  const otherSessions = $derived(sessions.filter((s) => s.id !== currentSessionId));

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function getDeviceName(sessionId: string): string {
    return decryptedDeviceNames[sessionId] ?? $t('security.sessions.unknown_device');
  }

  async function decryptDeviceNames(items: Session[]): Promise<void> {
    if (!cryptoManager.isInitialized()) return;
    const result: Record<string, string> = {};
    await Promise.all(
      items.map(async (s) => {
        if (s.device_info_encrypted) {
          try {
            result[s.id] = await cryptoManager.decryptText(s.device_info_encrypted);
          } catch {
            result[s.id] = $t('security.sessions.unknown_device');
          }
        }
      })
    );
    decryptedDeviceNames = result;
  }

  async function fetchSessions() {
    isLoading = true;
    error = null;
    try {
      const response = await authFetch(`${base}/api/auth/sessions`);
      const data = await response.json();
      if (data.success) {
        sessions = data.data;
        currentSessionId = data.currentSessionId ?? null;
        await decryptDeviceNames(sessions);
      } else {
        error = $t('security.sessions.error_load');
      }
    } catch {
      error = $t('security.sessions.connection_error');
    } finally {
      isLoading = false;
    }
  }

  async function revokeSession(id: string) {
    revoking = id;
    error = null;
    try {
      const response = await authFetch(`${base}/api/auth/sessions/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        sessions = sessions.filter((s) => s.id !== id);
        toast.success($t('security.sessions.revoke_success'));
      } else {
        toast.error($t('security.sessions.revoke_error'));
      }
    } catch {
      toast.error($t('security.sessions.connection_error'));
    } finally {
      revoking = null;
    }
  }

  async function revokeAllOther() {
    revokingAll = true;
    error = null;
    try {
      await Promise.all(
        otherSessions.map(async (s) => {
          const response = await authFetch(`${base}/api/auth/sessions/${s.id}`, {
            method: 'DELETE'
          });
          const data = await response.json();
          if (data.success) {
            sessions = sessions.filter((x) => x.id !== s.id);
          }
        })
      );
    } catch {
      toast.error($t('security.sessions.revoke_error'));
    } finally {
      revokingAll = false;
    }
  }

  async function logoutAll() {
    isLoggingOut = true;
    showLogoutAllConfirm = false;
    try {
      // Call server to invalidate all sessions
      await authFetch(`${base}/api/auth/logout-all`, { method: 'POST' });
      toast.success($t('security.sessions.logout_all_success'));
    } catch (err: unknown) {
      logger.warn('Server logout-all call failed:', err);
    }

    // Reset session expired flag — this is an intentional logout, not expiry
    sessionExpired.set(false);

    // Clear local auth state and redirect to login
    // authStore.logout() does hard redirect (window.location.href) — no code after it will execute
    authStore.logout();
  }

  onMount(() => {
    fetchSessions();
  });
</script>

<svelte:head>
  <title>{$t('security.sessions.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('security.sessions.title')} backHref="/settings">
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon"
      onclick={fetchSessions}
      disabled={isLoading}
      aria-label="Refresh"
    >
      <RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin' : ''}" />
    </Button>
  {/snippet}

  <div class="space-y-4">
    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    {#if isLoading}
      <div class="flex justify-center py-12">
        <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    {:else if sessions.length === 0}
      <Card>
        <CardContent class="px-4 py-8 text-center text-sm text-muted-foreground">
          {$t('security.sessions.no_sessions')}
        </CardContent>
      </Card>
    {:else}
      <!-- Current session -->
      {#if currentSession}
        <Card class="border-primary/30">
          <div class="flex items-center gap-3 px-4 py-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"
            >
              <Monitor class="h-4 w-4 text-primary" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate text-sm font-medium">
                  {getDeviceName(currentSession.id)}
                </p>
                <span
                  class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                >
                  {$t('security.sessions.current_session')}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {$t('security.sessions.logged_in')}: {formatDate(currentSession.login_at)}
              </p>
              <p class="text-xs text-muted-foreground">
                {$t('security.sessions.expires')}: {formatDate(currentSession.expires_at)}
              </p>
            </div>
          </div>
        </Card>
      {/if}

      <!-- Other sessions -->
      {#if otherSessions.length > 0}
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium text-muted-foreground">
            {$t('security.sessions.other_sessions', { values: { count: otherSessions.length } })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onclick={revokeAllOther}
            disabled={revokingAll}
            class="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            {revokingAll
              ? $t('security.sessions.revoking_all')
              : $t('security.sessions.revoke_all')}
          </Button>
        </div>

        <Card>
          <CardContent class="divide-y p-0">
          {#each otherSessions as session (session.id)}
            <div class="flex items-center gap-3 px-4 py-3">
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Monitor class="h-4 w-4 text-muted-foreground" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {getDeviceName(session.id)}
                </p>
                <p class="text-xs text-muted-foreground">
                  {$t('security.sessions.logged_in')}: {formatDate(session.login_at)}
                </p>
                <p class="text-xs text-muted-foreground">
                  {$t('security.sessions.expires')}: {formatDate(session.expires_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onclick={() => revokeSession(session.id)}
                disabled={revoking === session.id || revokingAll}
                aria-label={$t('security.sessions.revoke_session')}
                class="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                {#if revoking === session.id}
                  <RefreshCw class="h-4 w-4 animate-spin" />
                {:else}
                  <X class="h-4 w-4" />
                {/if}
              </Button>
            </div>
          {/each}
          </CardContent>
        </Card>
      {/if}

      <!-- Logout all devices -->
      {#if !showLogoutAllConfirm}
        <Button
          variant="destructive"
          onclick={() => (showLogoutAllConfirm = true)}
          disabled={isLoggingOut}
          class="w-full mt-2"
        >
          <LogOut class="h-4 w-4 mr-2" />
          {$t('security.sessions.logout_all_button')}
        </Button>
      {:else}
        <Alert variant="destructive">
          <AlertTriangle class="h-4 w-4" />
          <AlertDescription>
            {$t('security.sessions.logout_all_confirm')}
          </AlertDescription>
        </Alert>
        <div class="flex gap-2 flex-wrap mt-2">
          <Button variant="destructive" onclick={logoutAll} disabled={isLoggingOut}>
            {isLoggingOut
              ? $t('security.sessions.revoking_all')
              : $t('security.sessions.logout_all_button')}
          </Button>
          <Button
            variant="outline"
            onclick={() => (showLogoutAllConfirm = false)}
            disabled={isLoggingOut}
          >
            {$t('security.sessions.cancel') || 'Cancel'}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</SettingsLayout>
