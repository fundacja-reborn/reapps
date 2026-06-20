<script lang="ts">
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/utils/auth-fetch';
  import { copyText } from '$lib/utils/clipboard';
  import { API_BASE } from '$lib/utils/api-base';
  import {
    Shield,
    ShieldCheck,
    ShieldOff,
    RefreshCw,
    AlertTriangle,
    Copy,
    Check,
    Download
  } from '@lucide/svelte';
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
    AlertDescription,
    Separator
  } from '@reborn/ui';
  import { toast } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';
  import QRCode from 'qrcode';
  import { t } from '$lib/stores/i18n.store';

  const logger = createLogger('TwoFactorPage');

  type Step = 'loading' | 'status' | 'setup' | 'recovery-codes' | 'enabled';

  let step = $state<Step>('loading');
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  // Setup state
  let secretBase32 = $state('');
  let qrDataUrl = $state('');

  // Verify state
  let verificationCode = $state('');
  let submitAttempted = $state(false);

  // Disable state
  let disablePassword = $state('');
  let showDisableConfirm = $state(false);
  let isDisabling = $state(false);

  // Status
  let is2FAEnabled = $state(false);

  // Secret copied
  let secretCopied = $state(false);

  // Recovery codes
  let recoveryCodes = $state<string[]>([]);
  let copiedIndex = $state<number | null>(null);

  async function fetchStatus() {
    try {
      const response = await authFetch(`${API_BASE}/auth/2fa`);
      const data = await response.json();
      if (data.success) {
        is2FAEnabled = data.data.isEnabled;
        step = is2FAEnabled ? 'enabled' : 'status';
      } else {
        error = data.error || $t('security.two_factor.fetch_error');
        step = 'status';
      }
    } catch (err: unknown) {
      logger.error('Failed to fetch 2FA status:', err);
      error = $t('security.two_factor.connection_error');
      step = 'status';
    }
  }

  async function startSetup() {
    isLoading = true;
    error = null;
    try {
      const response = await authFetch(`${API_BASE}/auth/2fa`, {
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        secretBase32 = data.data.secret;
        qrDataUrl = await QRCode.toDataURL(data.data.otpauthUri, {
          width: 256,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        step = 'setup';
      } else {
        error = data.error || $t('security.two_factor.setup_error');
      }
    } catch (err: unknown) {
      logger.error('Failed to start 2FA setup:', err);
      error = $t('security.two_factor.connection_error');
    } finally {
      isLoading = false;
    }
  }

  async function verifyAndEnable() {
    submitAttempted = true;
    error = null;
    if (!verificationCode || verificationCode.length !== 6) return;
    isLoading = true;
    try {
      const response = await authFetch(`${API_BASE}/auth/2fa`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode, secretEncrypted: '' })
      });
      const data = await response.json();
      if (data.success) {
        toast.success($t('security.two_factor.enabled_toast'));
        is2FAEnabled = true;
        verificationCode = '';
        submitAttempted = false;
        secretBase32 = '';
        qrDataUrl = '';

        // Auto-generate recovery codes
        try {
          const codesResponse = await authFetch(`${API_BASE}/auth/recovery-codes`, {
            method: 'POST'
          });
          const codesData = await codesResponse.json();
          if (codesData.success && codesData.data.codes?.length) {
            recoveryCodes = codesData.data.codes;
            step = 'recovery-codes';
          } else {
            logger.warn('Recovery codes generation failed, skipping to enabled');
            toast.warning($t('security.recovery_codes.generate_failed_warning'));
            step = 'enabled';
          }
        } catch (codesErr) {
          logger.warn('Recovery codes generation error:', codesErr);
          toast.warning($t('security.recovery_codes.generate_failed_warning'));
          step = 'enabled';
        }
      } else {
        error =
          data.error === 'Invalid verification code'
            ? $t('security.two_factor.invalid_code')
            : data.error || $t('security.two_factor.fetch_error');
      }
    } catch (err: unknown) {
      logger.error('Failed to verify 2FA:', err);
      error = $t('security.two_factor.connection_error');
    } finally {
      isLoading = false;
    }
  }

  async function disable2FA() {
    if (!disablePassword) {
      error = $t('security.two_factor.password_required');
      return;
    }
    isDisabling = true;
    error = null;
    try {
      const response = await authFetch(`${API_BASE}/auth/2fa`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword })
      });
      const data = await response.json();
      if (data.success) {
        toast.success($t('security.two_factor.disabled_toast'));
        is2FAEnabled = false;
        step = 'status';
        showDisableConfirm = false;
        disablePassword = '';
      } else {
        error =
          data.error === 'Invalid password'
            ? $t('security.two_factor.invalid_password')
            : data.error || $t('security.two_factor.disable_error');
      }
    } catch (err: unknown) {
      logger.error('Failed to disable 2FA:', err);
      error = $t('security.two_factor.connection_error');
    } finally {
      isDisabling = false;
    }
  }

  function downloadCodes() {
    if (!recoveryCodes.length) return;
    const content = [
      $t('security.recovery_codes.file_header'),
      `${$t('security.recovery_codes.file_generated')} ${new Date().toLocaleString()}`,
      '',
      $t('security.recovery_codes.file_warning'),
      '',
      ...recoveryCodes.map((code, i) => `${i + 1}. ${code}`)
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reborn-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyCode(code: string, index: number) {
    if (!(await copyText(code))) return;
    copiedIndex = index;
    setTimeout(() => (copiedIndex = null), 2000);
  }

  async function copyAllCodes() {
    if (!recoveryCodes.length) return;
    if (await copyText(recoveryCodes.join('\n'))) {
      toast.success($t('security.recovery_codes.copied'));
    }
  }

  async function copySecret() {
    if (!(await copyText(secretBase32))) return;
    secretCopied = true;
    setTimeout(() => (secretCopied = false), 2000);
  }

  const codeError = $derived.by(() => {
    if (!submitAttempted) return null;
    if (!verificationCode) return $t('security.two_factor.code_required');
    if (verificationCode.length !== 6) return $t('security.two_factor.code_6_digits');
    return null;
  });

  onMount(() => {
    fetchStatus();
  });
</script>

<svelte:head>
  <title>{$t('security.two_factor.page_title')} - re/notes</title>
</svelte:head>

<SettingsLayout title={$t('security.two_factor.title')} backHref="/settings">
  <div class="space-y-6">
    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    {#if step === 'loading'}
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center justify-center py-8">
            <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    {:else if step === 'status'}
      <!-- 2FA not enabled -->
      <Alert>
        <Shield class="h-4 w-4" />
        <AlertDescription>
          {$t('security.two_factor.info')}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <ShieldOff class="h-4 w-4 text-muted-foreground" />
            {$t('security.two_factor.disabled_title')}
          </CardTitle>
          <CardDescription>
            {$t('security.two_factor.disabled_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onclick={startSetup} disabled={isLoading} class="w-full sm:w-auto">
            {#if isLoading}
              <RefreshCw class="h-4 w-4 mr-2 animate-spin" />
              {$t('security.two_factor.loading')}
            {:else}
              <Shield class="h-4 w-4 mr-2" />
              {$t('security.two_factor.enable_2fa')}
            {/if}
          </Button>
        </CardContent>
      </Card>
    {:else if step === 'setup'}
      <!-- Setup: QR code + verify -->
      <Alert>
        <AlertTriangle class="h-4 w-4" />
        <AlertDescription>
          <strong>{$t('security.two_factor.dont_refresh')}</strong>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">
            {$t('security.two_factor.setup_title')}
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-6">
          <!-- Step 1 -->
          <div class="space-y-2">
            <p class="text-sm font-medium">{$t('security.two_factor.step1')}</p>
          </div>

          <!-- Step 2: QR Code -->
          <div class="space-y-3">
            <p class="text-sm font-medium">{$t('security.two_factor.step2')}</p>
            <div class="flex justify-center">
              {#if qrDataUrl}
                <div class="rounded-lg border bg-white p-3">
                  <img src={qrDataUrl} alt="TOTP QR Code" class="h-48 w-48 sm:h-56 sm:w-56" />
                </div>
              {/if}
            </div>

            <!-- Manual secret -->
            <div class="space-y-2">
              <p class="text-xs text-muted-foreground text-center">
                {$t('security.two_factor.manual_entry')}
              </p>
              <div class="flex items-center justify-center gap-2">
                <code
                  class="bg-muted px-3 py-1.5 rounded text-sm font-mono tracking-wider select-all"
                >
                  {secretBase32}
                </code>
                <button
                  type="button"
                  onclick={copySecret}
                  class="text-muted-foreground hover:text-foreground transition-colors p-1"
                  aria-label={$t('security.two_factor.copy_secret')}
                >
                  {#if secretCopied}
                    <Check class="h-4 w-4 text-green-500" />
                  {:else}
                    <Copy class="h-4 w-4" />
                  {/if}
                </button>
              </div>
            </div>
          </div>

          <Separator />

          <!-- Step 3: Verification -->
          <div class="space-y-3">
            <p class="text-sm font-medium">{$t('security.two_factor.step3')}</p>
            <form
              onsubmit={(e) => {
                e.preventDefault();
                verifyAndEnable();
              }}
              class="space-y-4"
            >
              <div class="space-y-2">
                <Label for="verification-code">{$t('security.two_factor.verification_code')}</Label>
                <Input
                  id="verification-code"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  oninput={(e) => { const next = e.currentTarget.value.replace(/\D/g, '').slice(0, 6); if (e.currentTarget.value !== next) e.currentTarget.value = next; verificationCode = next; }}
                  pattern="[0-9]*"
                  placeholder="000000"
                  bind:value={verificationCode}
                  disabled={isLoading}
                  class={codeError
                    ? 'border-destructive font-mono text-center text-lg tracking-widest'
                    : 'font-mono text-center text-lg tracking-widest'}
                />
                {#if codeError}
                  <p class="text-sm text-destructive">{codeError}</p>
                {/if}
              </div>

              <div class="flex gap-2 flex-wrap">
                <Button type="submit" disabled={isLoading}>
                  {#if isLoading}
                    <RefreshCw class="h-4 w-4 mr-2 animate-spin" />
                    {$t('security.two_factor.verifying')}
                  {:else}
                    {$t('security.two_factor.verify_enable')}
                  {/if}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onclick={() => {
                    step = 'status';
                    error = null;
                    verificationCode = '';
                    submitAttempted = false;
                  }}
                  disabled={isLoading}
                >
                  {$t('security.two_factor.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>
    {:else if step === 'recovery-codes'}
      <!-- Recovery codes after 2FA setup -->
      <Alert>
        <AlertTriangle class="h-4 w-4" />
        <AlertDescription>
          {$t('security.recovery_codes.save_codes')}
        </AlertDescription>
      </Alert>

      <Card class="border-primary/50">
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <ShieldCheck class="h-4 w-4 text-green-600 dark:text-green-400" />
            {$t('security.recovery_codes.setup_title')}
          </CardTitle>
          <CardDescription>
            {$t('security.recovery_codes.setup_description')}
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- Code grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {#each recoveryCodes as code, i}
              <div
                class="flex items-center justify-between font-mono text-sm bg-muted px-3 py-2 rounded border"
              >
                <span class="tracking-widest">{code}</span>
                <button
                  type="button"
                  onclick={() => copyCode(code, i)}
                  class="ml-2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={$t('security.recovery_codes.copy_code')}
                >
                  {#if copiedIndex === i}
                    <Check class="h-4 w-4 text-green-500" />
                  {:else}
                    <Copy class="h-4 w-4" />
                  {/if}
                </button>
              </div>
            {/each}
          </div>

          <Separator />

          <div class="flex gap-2 flex-wrap">
            <Button onclick={downloadCodes} variant="outline">
              <Download class="h-4 w-4 mr-2" />
              {$t('security.recovery_codes.download')}
            </Button>
            <Button onclick={copyAllCodes} variant="outline">
              <Copy class="h-4 w-4 mr-2" />
              {$t('security.recovery_codes.copy_all')}
            </Button>
          </div>

          <Separator />

          <Button
            onclick={() => {
              recoveryCodes = [];
              step = 'enabled';
            }}
            class="w-full"
          >
            {$t('security.recovery_codes.saved_continue')}
          </Button>
        </CardContent>
      </Card>
    {:else if step === 'enabled'}
      <!-- 2FA is enabled -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <ShieldCheck class="h-4 w-4 text-green-600 dark:text-green-400" />
            {$t('security.two_factor.enabled_title')}
          </CardTitle>
          <CardDescription>
            {$t('security.two_factor.enabled_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          {#if !showDisableConfirm}
            <Button
              variant="destructive"
              onclick={() => (showDisableConfirm = true)}
              class="w-full sm:w-auto"
            >
              <ShieldOff class="h-4 w-4 mr-2" />
              {$t('security.two_factor.disable_2fa')}
            </Button>
          {:else}
            <Alert variant="destructive">
              <AlertTriangle class="h-4 w-4" />
              <AlertDescription>
                {$t('security.two_factor.disable_warning')}
              </AlertDescription>
            </Alert>

            <form
              onsubmit={(e) => {
                e.preventDefault();
                disable2FA();
              }}
              class="space-y-4"
            >
              <div class="space-y-2">
                <Label for="disable-password">{$t('security.two_factor.password')}</Label>
                <Input
                  id="disable-password"
                  type="password"
                  autocomplete="current-password"
                  bind:value={disablePassword}
                  disabled={isDisabling}
                />
              </div>

              <div class="flex gap-2 flex-wrap">
                <Button type="submit" variant="destructive" disabled={isDisabling}>
                  {#if isDisabling}
                    <RefreshCw class="h-4 w-4 mr-2 animate-spin" />
                    {$t('security.two_factor.disabling')}
                  {:else}
                    {$t('security.two_factor.confirm_disable')}
                  {/if}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onclick={() => {
                    showDisableConfirm = false;
                    disablePassword = '';
                    error = null;
                  }}
                  disabled={isDisabling}
                >
                  {$t('security.two_factor.cancel')}
                </Button>
              </div>
            </form>
          {/if}
        </CardContent>
      </Card>
    {/if}
  </div>
</SettingsLayout>
