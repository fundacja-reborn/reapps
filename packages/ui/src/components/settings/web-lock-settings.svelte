<!--
  @component
  Settings for the Web App Lock (account sessions in the browser / PWA),
  shared by both apps. The lock is off by default; while it is on, the
  encryption key is kept in memory only and the account password is needed on
  every start, after a reload and after the chosen idle time.

  Turning the lock on or off asks for the account password: enabling must
  prove the password really opens the key (otherwise the lock could never be
  opened again), and disabling stores the key in the browser again, which must
  not be possible for someone who merely found an unlocked tab.

  The component holds no key material - the app passes callbacks that talk to
  `@reborn/crypto`.
-->
<script lang="ts">
  import { t } from '@reborn/i18n';
  import { Lock, LockOpen } from '@lucide/svelte';
  import { Alert, AlertDescription } from '../alert';
  import { Button } from '../button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../card';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '../dialog';
  import { toast } from '../sonner';
  import type { WebLockChangeResult } from './web-lock-types';

  let {
    enabled,
    timeoutMs,
    timeoutPresets,
    username = '',
    showReminderNote = false,
    onEnable,
    onDisable,
    onTimeoutChange,
    onLockNow
  } = $props<{
    /** Whether the lock is currently on. */
    enabled: boolean;
    /** Selected idle timeout (ms); 0 = never lock on idle. */
    timeoutMs: number;
    /** Idle presets to offer (ms), in display order. */
    timeoutPresets: readonly number[];
    /** Account username - lets password managers match the password field. */
    username?: string;
    /** Show the note about background reminders (re/task only). */
    showReminderNote?: boolean;
    onEnable: (password: string) => Promise<WebLockChangeResult>;
    onDisable: (password: string) => Promise<WebLockChangeResult>;
    onTimeoutChange: (ms: number) => void;
    onLockNow: () => void;
  }>();

  const TIMEOUT_LABELS: Record<number, string> = {
    60000: 'web_lock.timeout.min1',
    300000: 'web_lock.timeout.min5',
    900000: 'web_lock.timeout.min15',
    3600000: 'web_lock.timeout.min60',
    0: 'web_lock.timeout.never'
  };

  /** Which change the password dialog is confirming, or null when closed. */
  let pending = $state<'enable' | 'disable' | null>(null);
  let password = $state('');
  let busy = $state(false);
  let wrongPassword = $state(false);

  let dialogOpen = $derived(pending !== null);

  function ask(change: 'enable' | 'disable') {
    password = '';
    wrongPassword = false;
    pending = change;
  }

  function closeDialog() {
    if (busy) return;
    pending = null;
    password = '';
    wrongPassword = false;
  }

  async function confirm(event: Event) {
    event.preventDefault();
    const change = pending;
    if (!change || !password || busy) return;
    busy = true;
    wrongPassword = false;
    try {
      const result = change === 'enable' ? await onEnable(password) : await onDisable(password);
      if (result === 'ok') {
        pending = null;
        password = '';
        toast.success(
          change === 'enable' ? $t('web_lock.success_enabled') : $t('web_lock.success_disabled')
        );
      } else if (result === 'invalid_password') {
        wrongPassword = true;
      } else {
        toast.error($t('web_lock.failed'));
      }
    } catch {
      toast.error($t('web_lock.failed'));
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-6">
  <Alert>
    <Lock class="h-4 w-4" />
    <AlertDescription>{$t('web_lock.intro')}</AlertDescription>
  </Alert>

  <Card>
    <CardHeader>
      <CardTitle class="text-base flex items-center gap-2">
        {#if enabled}
          <Lock class="h-4 w-4 text-muted-foreground" />
          {$t('web_lock.status_on')}
        {:else}
          <LockOpen class="h-4 w-4 text-muted-foreground" />
          {$t('web_lock.status_off')}
        {/if}
      </CardTitle>
      <CardDescription>
        {enabled ? $t('web_lock.status_on_desc') : $t('web_lock.status_off_desc')}
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if enabled}
        <Button variant="outline" onclick={() => ask('disable')}>
          {$t('web_lock.disable_cta')}
        </Button>
      {:else}
        <Button onclick={() => ask('enable')} class="w-full sm:w-auto">
          {$t('web_lock.enable_cta')}
        </Button>
      {/if}
    </CardContent>
  </Card>

  {#if enabled}
    <Card>
      <CardHeader>
        <CardTitle class="text-base">{$t('web_lock.timeout_title')}</CardTitle>
        <CardDescription>{$t('web_lock.timeout_desc')}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-2">
        {#each timeoutPresets as ms (ms)}
          <button
            type="button"
            aria-pressed={timeoutMs === ms}
            class="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-start text-sm transition-colors hover:bg-muted/50 {timeoutMs ===
            ms
              ? 'border-primary bg-primary/5'
              : 'border-border'}"
            onclick={() => onTimeoutChange(ms)}
          >
            <span class="font-medium">{$t(TIMEOUT_LABELS[ms] ?? 'web_lock.timeout.min5')}</span>
            {#if timeoutMs === ms}
              <span class="text-primary text-xs font-semibold" aria-hidden="true">✓</span>
            {/if}
          </button>
        {/each}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">{$t('web_lock.lock_now_title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between gap-4">
          <div class="text-sm text-muted-foreground">{$t('web_lock.lock_now_desc')}</div>
          <Button variant="outline" onclick={onLockNow}>
            {$t('web_lock.lock_now_cta')}
          </Button>
        </div>
      </CardContent>
    </Card>
  {/if}

  <Card>
    <CardHeader>
      <CardTitle class="text-base">{$t('web_lock.notes_title')}</CardTitle>
    </CardHeader>
    <CardContent>
      <ul class="list-disc space-y-2 ps-5 text-sm text-muted-foreground">
        <li>{$t('web_lock.note_session')}</li>
        <li>{$t('web_lock.note_metadata')}</li>
        {#if showReminderNote}
          <li>{$t('web_lock.note_reminders')}</li>
        {/if}
      </ul>
    </CardContent>
  </Card>
</div>

<Dialog
  open={dialogOpen}
  onOpenChange={(isOpen: boolean) => {
    if (!isOpen) closeDialog();
  }}
>
  <DialogContent>
    <form onsubmit={confirm} class="space-y-4">
      <DialogHeader>
        <DialogTitle>
          {pending === 'disable'
            ? $t('web_lock.confirm_disable_title')
            : $t('web_lock.confirm_enable_title')}
        </DialogTitle>
        <DialogDescription>
          {pending === 'disable'
            ? $t('web_lock.confirm_disable_desc')
            : $t('web_lock.confirm_enable_desc')}
        </DialogDescription>
      </DialogHeader>

      <!-- Hidden username: lets a password manager offer the right entry. -->
      <input
        type="text"
        name="username"
        autocomplete="username"
        value={username}
        readonly
        hidden
      />

      <div class="space-y-2">
        <label for="web-lock-password" class="block text-sm font-medium">
          {$t('auth.unlock.password_label')}
        </label>
        <input
          id="web-lock-password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          bind:value={password}
          disabled={busy}
          aria-invalid={wrongPassword}
          class="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {#if wrongPassword}
          <p role="alert" class="text-sm text-destructive">{$t('web_lock.wrong_password')}</p>
        {/if}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onclick={closeDialog} disabled={busy}>
          {$t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !password}>
          {$t('common.confirm')}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
