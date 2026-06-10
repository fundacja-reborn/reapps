<script lang="ts">
  import { authFetch } from '$lib/utils/auth-fetch';
  import { API_BASE } from '$lib/utils/api-base';
  import { AlertTriangle, Trash2 } from '@lucide/svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Label,
    Input,
    Button,
    Alert,
    AlertDescription
  } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';
  import { authStore } from '$lib/stores/auth.store';
  import { t } from '$lib/stores/i18n.store';

  const logger = createLogger('Notes-DeleteAccountPage');

  let password = $state('');
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let submitAttempted = $state(false);

  const passwordError = $derived(
    submitAttempted && !password ? $t('security.delete_account.required') : null
  );

  async function handleDelete(e: Event) {
    e.preventDefault();
    submitAttempted = true;
    error = null;

    if (!password) return;

    isLoading = true;
    try {
      const response = await authFetch(`${API_BASE}/auth/delete-account`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 400 && data.error === 'Invalid password') {
          error = $t('security.delete_account.invalid_password');
        } else {
          error = data.error ?? $t('security.delete_account.failed');
        }
        return;
      }

      authStore.logout();
    } catch (err: unknown) {
      logger.error('Failed to delete account:', err);
      error = $t('security.delete_account.unexpected_error');
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{$t('security.delete_account.title')} - re/notes</title>
</svelte:head>

<SettingsLayout title={$t('security.delete_account.title')} backHref="/settings">
  <div class="space-y-6">
    <!-- Danger warning -->
    <Alert variant="destructive">
      <AlertTriangle class="h-4 w-4" />
      <AlertDescription class="space-y-1">
        <div class="font-semibold">{$t('security.delete_account.irreversible_title')}</div>
        <div>{$t('security.delete_account.irreversible_desc')}</div>
      </AlertDescription>
    </Alert>

    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    <Card class="border-destructive/40">
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2 text-destructive">
          <Trash2 class="h-4 w-4" />
          {$t('security.delete_account.card_title')}
        </CardTitle>
        <CardDescription>{$t('security.delete_account.card_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onsubmit={handleDelete} class="space-y-4">
          <div class="space-y-2">
            <Label for="confirm-password">{$t('security.delete_account.password')}</Label>
            <Input
              id="confirm-password"
              type="password"
              bind:value={password}
              placeholder={$t('security.delete_account.password_placeholder')}
              autocomplete="current-password"
              disabled={isLoading}
              class={passwordError ? 'border-destructive' : ''}
            />
            {#if passwordError}
              <p class="text-sm text-destructive">{passwordError}</p>
            {/if}
          </div>

          <Button variant="destructive" type="submit" disabled={isLoading}>
            {isLoading
              ? $t('security.delete_account.deleting')
              : $t('security.delete_account.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
