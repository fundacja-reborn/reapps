<script lang="ts">
  import { tick } from 'svelte';
  import { API_BASE } from '$lib/utils/api-base';
  import { authFetch } from '$lib/utils/auth-fetch';
  import { Lock, AlertTriangle, Eye, EyeOff } from '@lucide/svelte';
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
  let showPassword = $state(false);
  let isLoading = $state(false);
  let submitAttempted = $state(false);
  // Errors sit next to what the user acted on (guideline 02): a field's error
  // under the field, any other failure right above the submit button.
  let currentRejected = $state(false);
  let submitError = $state<string | null>(null);
  let currentPasswordInput = $state<HTMLElement | null>(null);
  let newPasswordInput = $state<HTMLElement | null>(null);
  let confirmPasswordInput = $state<HTMLElement | null>(null);

  const currentPasswordError = $derived.by(() => {
    if (!submitAttempted) return null;
    if (!currentPassword) return $t('security.password.required');
    if (currentRejected) return $t('security.password.incorrect');
    return null;
  });

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

  function focusFirstInvalid() {
    if (currentPasswordError) currentPasswordInput?.focus();
    else if (newPasswordError) newPasswordInput?.focus();
    else if (confirmPasswordError) confirmPasswordInput?.focus();
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitAttempted = true;
    currentRejected = false;
    submitError = null;

    if (currentPasswordError || newPasswordError || confirmPasswordError) {
      focusFirstInvalid();
      return;
    }
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) return;

    isLoading = true;
    try {
      const masterKey = cryptoManager.getCurrentKey();
      if (!masterKey) {
        submitError = $t('security.password.key_error');
        return;
      }

      const { encryptedMasterKey: newEncryptedMasterKey, salt: newMasterKeySalt } =
        await cryptoManager.encryptMasterKey(masterKey, newPassword);

      const response = await authFetch(`${API_BASE}/auth/change-password`, {
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
        // The server's `error` is English text for logs, never shown as is.
        if (data.error === 'Current password is incorrect') {
          currentRejected = true;
        } else {
          submitError = $t('security.password.failed');
        }
      } else {
        // Save new access token (old one was blacklisted server-side)
        if (data.data?.access_token) {
          localStorage.setItem('access_token', data.data.access_token);
        }

        toast.success($t('security.password.changed_toast'));

        // Logout - all tokens invalidated
        authStore.logout();
      }
    } catch (err: unknown) {
      logger.error('Failed to change password:', err);
      submitError = $t('security.password.unexpected_error');
    } finally {
      isLoading = false;
    }
    // The fields are disabled while the request runs; focus once they are back.
    if (currentRejected) {
      await tick();
      currentPasswordInput?.focus();
    }
  }
</script>

<svelte:head>
  <title>{$t('security.password.title')} - re/notes</title>
</svelte:head>

{#snippet revealToggle()}
  <button
    type="button"
    class="absolute inset-y-0 inset-e-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
    onclick={() => (showPassword = !showPassword)}
    tabindex={-1}
    aria-label={$t('security.password.toggle_visibility')}
  >
    {#if showPassword}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
  </button>
{/snippet}

<SettingsLayout title={$t('security.password.title')} backHref="/settings">
  <div class="space-y-6">
    <!-- Warning -->
    <Alert>
      <AlertTriangle class="h-4 w-4" />
      <AlertDescription>
        {$t('security.password.warning')}
      </AlertDescription>
    </Alert>

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
            <div class="relative">
              <Input
                id="current-password"
                type={showPassword ? 'text' : 'password'}
                bind:value={currentPassword}
                bind:ref={currentPasswordInput}
                oninput={() => (currentRejected = false)}
                autocomplete="current-password"
                disabled={isLoading}
                aria-invalid={currentPasswordError ? 'true' : undefined}
                aria-describedby={currentPasswordError ? 'current-password-error' : undefined}
                class="pe-10 {currentPasswordError ? 'border-destructive' : ''}"
              />
              {@render revealToggle()}
            </div>
            {#if currentPasswordError}
              <p id="current-password-error" class="text-sm text-destructive">
                {currentPasswordError}
              </p>
            {/if}
          </div>

          <!-- New password -->
          <div class="space-y-2">
            <Label for="new-password">{$t('security.password.new_pwd')}</Label>
            <div class="relative">
              <Input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                bind:value={newPassword}
                bind:ref={newPasswordInput}
                autocomplete="new-password"
                disabled={isLoading}
                aria-invalid={newPasswordError ? 'true' : undefined}
                aria-describedby={newPasswordError ? 'new-password-error' : undefined}
                class="pe-10 {newPasswordError ? 'border-destructive' : ''}"
              />
              {@render revealToggle()}
            </div>
            {#if newPasswordError}
              <p id="new-password-error" class="text-sm text-destructive">{newPasswordError}</p>
            {/if}
          </div>

          <!-- Confirm password -->
          <div class="space-y-2">
            <Label for="confirm-password">{$t('security.password.confirm')}</Label>
            <div class="relative">
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                bind:value={confirmPassword}
                bind:ref={confirmPasswordInput}
                autocomplete="new-password"
                disabled={isLoading}
                aria-invalid={confirmPasswordError ? 'true' : undefined}
                aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
                class="pe-10 {confirmPasswordError ? 'border-destructive' : ''}"
              />
              {@render revealToggle()}
            </div>
            {#if confirmPasswordError}
              <p id="confirm-password-error" class="text-sm text-destructive">
                {confirmPasswordError}
              </p>
            {/if}
          </div>

          {#if submitError}
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          {/if}

          <!-- Submit -->
          <Button type="submit" disabled={isLoading}>
            {isLoading ? $t('security.password.saving') : $t('security.password.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</SettingsLayout>
