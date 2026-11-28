<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    Button,
    Alert,
    AlertDescription,
    WebLockSettings,
    toast
  } from '@reborn/ui';
  import { cryptoManager, WEB_LOCK_TIMEOUT_PRESETS_MS } from '@reborn/crypto';
  import {
    enableWebLock,
    disableWebLock,
    isWebLockEnabled,
    lockWebNow,
    setWebLockTimeout
  } from '$lib/services/web-lock.service';
  import { Fingerprint, ScanFace, Lock, ShieldAlert } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { goto } from '$lib/utils/navigation';
  import { authStore } from '$lib/stores/auth.store';
  import { createLogger } from '@reborn/utils';
  import { platform } from '$lib/platform';
  import { get } from 'svelte/store';
  import {
    enableAppLock,
    disableAppLock,
    isAppLockEnabled,
    lockNow,
    getAppLockAvailability,
    getTimeoutMs,
    setTimeoutMs,
    TIMEOUT_PRESETS_MS
  } from '$lib/services/app-lock.service';
  import type { BiometryKind } from '$lib/utils/native-biometric-auth';

  const logger = createLogger('AppLockSettingsPage');

  let enabled = $state(false);
  // null until the device answers, so "Biometrics not set up" never flashes
  // before the real state.
  let available = $state<boolean | null>(null);
  let biometryKind = $state<BiometryKind>('none');
  let timeoutMs = $state(getTimeoutMs());
  let busy = $state(false);

  // Web variant (browser / PWA): a different mechanism under the same name.
  // Native gates reading the device vault behind biometrics; on the web the
  // key is kept in memory only and the account password unlocks.
  let webEnabled = $state(false);
  let webTimeoutMs = $state(cryptoManager.getWebLockTimeoutMs());

  function refreshWebState() {
    webEnabled = isWebLockEnabled();
    webTimeoutMs = cryptoManager.getWebLockTimeoutMs();
  }

  async function handleWebEnable(password: string) {
    const result = await enableWebLock(password);
    refreshWebState();
    return result;
  }

  async function handleWebDisable(password: string) {
    const result = await disableWebLock(password);
    refreshWebState();
    return result;
  }

  function handleWebTimeout(ms: number) {
    setWebLockTimeout(ms);
    refreshWebState();
  }

  const biometryLabel = $derived(
    biometryKind === 'none'
      ? $t('app_lock.biometry.generic')
      : $t(`app_lock.biometry.${biometryKind}`)
  );

  const timeoutLabels: Record<number, string> = {
    0: 'app_lock.timeout.immediate',
    60000: 'app_lock.timeout.min1',
    300000: 'app_lock.timeout.min5',
    900000: 'app_lock.timeout.min15'
  };

  onMount(() => {
    // App Lock is an account-mode feature on both platforms: native needs the
    // master key in the device vault for the biometric gate, the web needs the
    // account's password wrap to unlock with. Local-only mode uses its
    // passcode lock instead.
    if (!get(authStore).isAuthenticated) {
      goto('/settings');
      return;
    }
    if (!__REBORN_NATIVE__) {
      refreshWebState();
      return;
    }
    enabled = isAppLockEnabled();
    refreshAvailability();
    // Coming back from the system settings (a fingerprint or a PIN just
    // added) must update the page without leaving it.
    return platform.lifecycle.onResume(refreshAvailability);
  });

  function refreshAvailability() {
    void getAppLockAvailability().then((status) => {
      available = status.isAvailable || status.deviceIsSecure;
      biometryKind = status.kind;
    });
  }

  async function handleEnable() {
    busy = true;
    try {
      const result = await enableAppLock({
        reason: $t('app_lock.prompt.reason'),
        cancelTitle: $t('app_lock.prompt.cancel'),
        androidTitle: $t('app_lock.prompt.android_title'),
        androidSubtitle: $t('app_lock.prompt.android_subtitle'),
        iosFallbackTitle: '',
        macosReason: $t('app_lock.prompt.macos_reason')
      });
      if (result.ok) {
        enabled = true;
        timeoutMs = getTimeoutMs();
        toast.success($t('app_lock.success_enabled'));
      } else if (
        result.code !== 'userCancel' &&
        result.code !== 'systemCancel' &&
        result.code !== 'appCancel'
      ) {
        toast.error($t('app_lock.enable_failed'));
      }
    } catch (err: unknown) {
      logger.error('Failed to enable App Lock:', err);
      toast.error($t('app_lock.enable_failed'));
    } finally {
      busy = false;
    }
  }

  function handleDisable() {
    disableAppLock();
    enabled = false;
    toast.success($t('app_lock.success_disabled'));
  }

  function selectTimeout(ms: number) {
    setTimeoutMs(ms);
    timeoutMs = ms;
  }

  function handleLockNow() {
    lockNow();
    goto('/auth/applock');
  }
</script>

{#if !__REBORN_NATIVE__}
  <SettingsLayout title={$t('web_lock.title')} backHref="/settings">
    <WebLockSettings
      enabled={webEnabled}
      timeoutMs={webTimeoutMs}
      timeoutPresets={WEB_LOCK_TIMEOUT_PRESETS_MS}
      username={$authStore.username ?? ''}
      onEnable={handleWebEnable}
      onDisable={handleWebDisable}
      onTimeoutChange={handleWebTimeout}
      onLockNow={() => void lockWebNow()}
    />
  </SettingsLayout>
{:else}
<SettingsLayout title={$t('app_lock.settings_item_title')} backHref="/settings">
  <div class="space-y-6">
    <Alert>
      <Lock class="h-4 w-4" />
      <AlertDescription>{$t('app_lock.settings_intro')}</AlertDescription>
    </Alert>

    {#if available === null}
      <!-- Waiting for the device's answer (a moment). -->
    {:else if !available}
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <ShieldAlert class="h-4 w-4 text-muted-foreground" />
            {$t('app_lock.unavailable_title')}
          </CardTitle>
          <CardDescription>{$t('app_lock.unavailable_desc')}</CardDescription>
        </CardHeader>
      </Card>
    {:else}
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            {#if biometryKind === 'faceId' || biometryKind === 'face'}
              <ScanFace class="h-4 w-4 text-muted-foreground" />
            {:else}
              <Fingerprint class="h-4 w-4 text-muted-foreground" />
            {/if}
            {$t('app_lock.enable_title')}
          </CardTitle>
          <CardDescription>
            {#if biometryKind === 'none'}
              {$t('app_lock.enable_desc_device_credential')}
            {:else}
              {$t('app_lock.enable_desc', { values: { biometry: biometryLabel } })}
            {/if}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {#if enabled}
            <Button variant="outline" onclick={handleDisable} disabled={busy}>
              {$t('app_lock.disable_cta')}
            </Button>
          {:else}
            <Button onclick={handleEnable} disabled={busy} class="w-full sm:w-auto">
              {$t('app_lock.enable_cta')}
            </Button>
          {/if}
        </CardContent>
      </Card>

      {#if enabled}
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{$t('app_lock.timeout_title')}</CardTitle>
            <CardDescription>{$t('app_lock.timeout_desc')}</CardDescription>
          </CardHeader>
          <CardContent class="space-y-2">
            {#each TIMEOUT_PRESETS_MS as ms (ms)}
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-start text-sm transition-colors hover:bg-muted/50 {timeoutMs ===
                ms
                  ? 'border-primary bg-primary/5'
                  : 'border-border'}"
                onclick={() => selectTimeout(ms)}
              >
                <span class="font-medium">{$t(timeoutLabels[ms])}</span>
                {#if timeoutMs === ms}
                  <span class="text-primary text-xs font-semibold">✓</span>
                {/if}
              </button>
            {/each}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">{$t('app_lock.lock_now_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center justify-between gap-4">
              <div class="text-sm text-muted-foreground">{$t('app_lock.lock_now_desc')}</div>
              <Button variant="outline" onclick={handleLockNow}>
                {$t('app_lock.lock_now_cta')}
              </Button>
            </div>
          </CardContent>
        </Card>
      {/if}
    {/if}
  </div>
</SettingsLayout>
{/if}
