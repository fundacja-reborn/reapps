<script lang="ts">
  import { tick } from 'svelte';
  import { authFetch } from '$lib/utils/auth-fetch';
  import { API_BASE } from '$lib/utils/api-base';
  import { AlertTriangle, Trash2, Eye, EyeOff } from '@lucide/svelte';
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
  let showPassword = $state(false);
  let isLoading = $state(false);
  let submitAttempted = $state(false);
  // Errors sit next to what the user acted on (guideline 02): the password's
  // error under the field, any other failure right above the delete button.
  let passwordRejected = $state(false);
  let submitError = $state<string | null>(null);
  let passwordInput = $state<HTMLElement | null>(null);

  const passwordError = $derived.by(() => {
    if (!submitAttempted) return null;
    if (!password) return $t('security.delete_account.required');
    if (passwordRejected) return $t('security.delete_account.invalid_password');
    return null;
  });

  async function handleDelete(e: Event) {
    e.preventDefault();
    submitAttempted = true;
    passwordRejected = false;
    submitError = null;

    if (!password) {
      passwordInput?.focus();
      return;
    }

    isLoading = true;
    try {
      const response = await authFetch(`${API_BASE}/auth/delete-account`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // The server's `error` is English text for logs, never shown as is.
        if (response.status === 400 && data.error === 'Invalid password') {
          passwordRejected = true;
        } else {
          submitError = $t('security.delete_account.failed');
        }
      } else {
        authStore.logout();
      }
    } catch (err: unknown) {
      logger.error('Failed to delete account:', err);
      submitError = $t('security.delete_account.unexpected_error');
    } finally {
      isLoading = false;
    }
    // The field is disabled while the request runs; focus it once it is back.
    if (passwordRejected) {
      await tick();
      passwordInput?.focus();
    }
  }
</script>

<svelte:head>
  <title>{$t('security.delete_account.title')} - re/notes</title>
</svelte:head>

{#snippet revealToggle()}
  <button
    type="button"
    class="absolute inset-y-0 inset-e-0 flex items-center pe-3 text-muted-foreground hover:text-foreground"
    onclick={() => (showPassword = !showPassword)}
    tabindex={-1}
    aria-label={$t('security.delete_account.toggle_visibility')}
  >
    {#if showPassword}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
  </button>
{/snippet}

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
            <div class="relative">
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                bind:ref={passwordInput}
                oninput={() => (passwordRejected = false)}
                placeholder={$t('security.delete_account.password_placeholder')}
                autocomplete="current-password"
                disabled={isLoading}
                aria-invalid={passwordError ? 'true' : undefined}
                aria-describedby={passwordError ? 'confirm-password-error' : undefined}
                class="pe-10 {passwordError ? 'border-destructive' : ''}"
              />
              {@render revealToggle()}
            </div>
            {#if passwordError}
              <p id="confirm-password-error" class="text-sm text-destructive">{passwordError}</p>
            {/if}
          </div>

          {#if submitError}
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          {/if}

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
