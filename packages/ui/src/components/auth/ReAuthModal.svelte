<!--
  @component
  Modal dialog for re-authentication when session has expired.

  Two-step flow when 2FA is enabled:
    1. Password step (username readonly, password input)
    2. TOTP step (6-digit code OR recovery code via toggle)

  Does NOT log out or clear the master key — just refreshes tokens so the
  user keeps offline access to locally decrypted data.
-->
<script lang="ts">
  import { t } from '@reborn/i18n';
  import { Button } from '../button';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '../dialog';
  import { KeyRound, Shield } from '@lucide/svelte';
  import type { ReAuthResult } from './reauth-types';

  let {
    open = $bindable(false),
    username = '',
    onSubmitPassword,
    onSubmitTotp
  } = $props<{
    open?: boolean;
    username?: string;
    /** Called with the password. Returns a ReAuthResult. */
    onSubmitPassword?: (password: string) => Promise<ReAuthResult>;
    /** Called with a TOTP or recovery code once 2FA is required. */
    onSubmitTotp?: (userId: string, code: string) => Promise<ReAuthResult>;
  }>();

  type Step = 'password' | 'totp';

  let step = $state<Step>('password');
  let password = $state('');
  let showPassword = $state(false);
  let totpCode = $state('');
  let useRecovery = $state(false);
  let pendingUserId = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  function resetAll() {
    step = 'password';
    password = '';
    showPassword = false;
    totpCode = '';
    useRecovery = false;
    pendingUserId = null;
    loading = false;
    error = null;
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    if (!isOpen) resetAll();
  }

  function describeResult(result: ReAuthResult): string | null {
    switch (result.kind) {
      case 'ok':
        return null;
      case 'invalid_password':
        return $t('auth.session.error_auth_failed');
      case 'invalid_totp':
        return $t('auth.session.totp_error_invalid');
      case 'locked':
        return $t('auth.session.error_locked', { values: { seconds: result.retryAfter } });
      case 'two_factor_required':
        return null;
      case 'error':
        return result.message ?? $t('auth.session.error_unknown');
      default:
        return $t('auth.session.error_unknown');
    }
  }

  async function handlePasswordSubmit(event: Event) {
    event.preventDefault();
    if (!password || loading) return;

    loading = true;
    error = null;

    try {
      const result = (await onSubmitPassword?.(password)) ?? {
        kind: 'error',
        message: $t('auth.session.error_unknown')
      };

      if (result.kind === 'ok') {
        open = false;
        resetAll();
        return;
      }

      if (result.kind === 'two_factor_required') {
        pendingUserId = result.userId;
        step = 'totp';
        totpCode = '';
        error = null;
        return;
      }

      error = describeResult(result);
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : $t('auth.session.error_unknown');
    } finally {
      loading = false;
    }
  }

  async function handleTotpSubmit(event: Event) {
    event.preventDefault();
    const trimmed = totpCode.trim();
    if (!trimmed || loading || !pendingUserId) return;

    if (!useRecovery && trimmed.length !== 6) {
      error = $t('auth.session.totp_error_invalid');
      return;
    }

    loading = true;
    error = null;

    try {
      const result = (await onSubmitTotp?.(pendingUserId, trimmed)) ?? {
        kind: 'error',
        message: $t('auth.session.error_unknown')
      };

      if (result.kind === 'ok') {
        open = false;
        resetAll();
        return;
      }

      error = describeResult(result);
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : $t('auth.session.error_unknown');
    } finally {
      loading = false;
    }
  }
</script>

<Dialog bind:open onOpenChange={handleOpenChange}>
  <DialogContent class="sm:max-w-md">
    {#if step === 'password'}
      <DialogHeader>
        <DialogTitle>{$t('auth.session.reauth_title')}</DialogTitle>
        <DialogDescription>
          {$t('auth.session.reauth_description')}
        </DialogDescription>
      </DialogHeader>

      <form onsubmit={handlePasswordSubmit} class="space-y-4">
        <div>
          <label for="reauth-username" class="block text-sm font-medium text-muted-foreground">
            {$t('auth.session.username_label')}
          </label>
          <input
            id="reauth-username"
            type="text"
            value={username}
            readonly
            disabled
            class="mt-1 block w-full rounded-md border border-input bg-muted px-3 py-2 text-sm opacity-75"
          />
        </div>

        <div>
          <label for="reauth-password" class="block text-sm font-medium text-foreground">
            {$t('auth.session.password_label')}
          </label>
          <div class="relative mt-1">
            <input
              id="reauth-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autocomplete="current-password"
              required
              bind:value={password}
              disabled={loading}
              placeholder={$t('auth.session.password_placeholder')}
              class="block w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 flex items-center pr-3"
              onclick={() => {
                showPassword = !showPassword;
              }}
            >
              {#if showPassword}
                <svg
                  class="h-4 w-4 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              {:else}
                <svg
                  class="h-4 w-4 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              {/if}
            </button>
          </div>
        </div>

        {#if error}
          <p class="text-sm text-destructive">{error}</p>
        {/if}

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onclick={() => {
              open = false;
            }}>{$t('common.cancel')}</Button
          >
          <Button type="submit" disabled={loading || !password}>
            {#if loading}
              {$t('auth.session.submitting')}
            {:else}
              {$t('auth.session.submit_button')}
            {/if}
          </Button>
        </DialogFooter>
      </form>
    {:else}
      <DialogHeader>
        <DialogTitle>{$t('auth.session.totp_title')}</DialogTitle>
        <DialogDescription>
          {$t('auth.session.totp_description')}
        </DialogDescription>
      </DialogHeader>

      <form onsubmit={handleTotpSubmit} class="space-y-4">
        {#if !useRecovery}
          <div>
            <label for="reauth-totp" class="block text-sm font-medium text-foreground">
              {$t('auth.session.totp_label')}
            </label>
            <input
              id="reauth-totp"
              name="totp"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength={6}
              pattern="[0-9]*"
              required
              bind:value={totpCode}
              disabled={loading}
              placeholder={$t('auth.session.totp_placeholder')}
              class="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-2xl tracking-[0.5em] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        {:else}
          <div>
            <label for="reauth-recovery" class="block text-sm font-medium text-foreground">
              {$t('auth.session.recovery_label')}
            </label>
            <input
              id="reauth-recovery"
              name="recovery"
              type="text"
              autocomplete="off"
              required
              bind:value={totpCode}
              disabled={loading}
              placeholder={$t('auth.session.recovery_placeholder')}
              class="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-lg tracking-wider placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        {/if}

        <div class="text-center">
          <button
            type="button"
            onclick={() => {
              useRecovery = !useRecovery;
              totpCode = '';
              error = null;
            }}
            class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground underline transition-colors"
          >
            {#if useRecovery}
              <Shield class="h-3.5 w-3.5" />
              {$t('auth.session.use_app')}
            {:else}
              <KeyRound class="h-3.5 w-3.5" />
              {$t('auth.session.use_recovery')}
            {/if}
          </button>
        </div>

        {#if error}
          <p class="text-sm text-destructive">{error}</p>
        {/if}

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onclick={() => {
              open = false;
            }}>{$t('common.cancel')}</Button
          >
          <Button type="submit" disabled={loading || !totpCode}>
            {#if loading}
              {$t('auth.session.totp_verifying')}
            {:else}
              {$t('auth.session.totp_submit_button')}
            {/if}
          </Button>
        </DialogFooter>
      </form>
    {/if}
  </DialogContent>
</Dialog>
