<script lang="ts">
  import { base } from '$app/paths';
  import { authFetch } from '$lib/utils/auth-fetch';
  import { Lock, AlertTriangle } from '@lucide/svelte';
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
  import { toast } from '@reborn/ui';
  import { cryptoManager } from '@reborn/crypto';
  import { createLogger } from '@reborn/utils';
  import { authStore } from '$lib/stores/auth.store';
  import { t } from '$lib/stores/i18n.store';

  const logger = createLogger('Notes-PasswordPage');

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let submitAttempted = $state(false);

  const currentPasswordError = $derived(
    submitAttempted && !currentPassword ? $t('security.password.required') : null
  );

  const newPasswordError = $derived.by(() => {
    if (!submitAttempted) return null;
    if (!newPassword) return $t('security.password.required');
    if (newPassword.length < 8) return $t('security.password.min_length');
    if (newPassword === currentPassword) return $t('security.password.must_differ');
    return null;
  });

  const confirmPasswordError = $derived.by(() => {
    if (!submitAttempted) return null;
    if (!confirmPassword) return $t('security.password.required');
    if (confirmPassword !== newPassword) return $t('security.password.mismatch');
    return null;
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitAttempted = true;
    error = null;

    if (currentPasswordError || newPasswordError || confirmPasswordError) return;
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) return;

    isLoading = true;
    try {
      const masterKey = cryptoManager.getCurrentKey();
      if (!masterKey) {
        error = $t('security.password.key_error');
        return;
      }

      const { encryptedMasterKey: newEncryptedMasterKey, salt: newMasterKeySalt } =
        await cryptoManager.encryptMasterKey(masterKey, newPassword);

      const response = await authFetch(`${base}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          newEncryptedMasterKey,
          newMasterKeySalt
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (data.error === 'Current password is incorrect') {
          error = $t('security.password.incorrect');
        } else {
          error = data.error ?? $t('security.password.failed');
        }
        return;
      }

      // Save new access token (old one was blacklisted server-side)
      if (data.data?.access_token) {
        localStorage.setItem('access_token', data.data.access_token);
      }

      toast.success($t('security.password.changed_toast'));

      // Logout — all tokens invalidated
      authStore.logout();
    } catch (err: unknown) {
      logger.error('Failed to change password:', err);
      error = $t('security.password.unexpected_error');
    } finally {
      isLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{$t('security.password.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('security.password.title')} backHref="/settings">
  <div class="space-y-6">
    <!-- Warning -->
    <Alert>
      <AlertTriangle class="h-4 w-4" />
      <AlertDescription>
        {$t('security.password.warning')}
      </AlertDescription>
    </Alert>

    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Lock class="h-4 w-4 text-muted-foreground" />
          {$t('security.password.card_title')}
        </CardTitle>
        <CardDescription>{$t('security.password.card_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onsubmit={handleSubmit} class="space-y-4">
          <!-- Current password -->
          <div class="space-y-2">
            <Label for="current-password">{$t('security.password.current')}</Label>
            <Input
              id="current-password"
              type="password"
              bind:value={currentPassword}
              autocomplete="current-password"
              disabled={isLoading}
              class={currentPasswordError ? 'border-destructive' : ''}
            />
            {#if currentPasswordError}
              <p class="text-sm text-destructive">{currentPasswordError}</p>
            {/if}
          </div>

          <!-- New password -->
          <div class="space-y-2">
            <Label for="new-password">{$t('security.password.new_pwd')}</Label>
            <Input
              id="new-password"
              type="password"
              bind:value={newPassword}
              autocomplete="new-password"
              disabled={isLoading}
              class={newPasswordError ? 'border-destructive' : ''}
            />
            {#if newPasswordError}
              <p class="text-sm text-destructive">{newPasswordError}</p>
            {/if}
          </div>

          <!-- Confirm password -->
          <div class="space-y-2">
            <Label for="confirm-password">{$t('security.password.confirm')}</Label>
            <Input
              id="confirm-password"
              type="password"
              bind:value={confirmPassword}
              autocomplete="new-password"
              disabled={isLoading}
              class={confirmPasswordError ? 'border-destructive' : ''}
            />
            {#if confirmPasswordError}
              <p class="text-sm text-destructive">{confirmPasswordError}</p>
            {/if}
          </div>

          <!-- Submit -->
          <Button type="submit" disabled={isLoading}>
            {isLoading ? $t('security.password.saving') : $t('security.password.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
