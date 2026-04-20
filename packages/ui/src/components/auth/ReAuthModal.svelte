<!--
  @component
  Modal dialog for re-authentication when session has expired.
  Asks for password only (username is readonly from the current session).
  Does NOT logout or clear master key — just refreshes tokens.
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

  let {
    open = $bindable(false),
    username = '',
    loading = false,
    error = null,
    onSubmit
  } = $props<{
    open?: boolean;
    username?: string;
    loading?: boolean;
    error?: string | null;
    onSubmit?: (password: string) => void;
  }>();

  let password = $state('');
  let showPassword = $state(false);

  function handleSubmit(event: Event) {
    event.preventDefault();
    if (!password || loading) return;
    onSubmit?.(password);
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    if (!isOpen) {
      password = '';
      showPassword = false;
    }
  }
</script>

<Dialog bind:open onOpenChange={handleOpenChange}>
  <DialogContent class="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>{$t('auth.session.reauth_title')}</DialogTitle>
      <DialogDescription>
        {$t('auth.session.reauth_description')}
      </DialogDescription>
    </DialogHeader>

    <form onsubmit={handleSubmit} class="space-y-4">
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
  </DialogContent>
</Dialog>
