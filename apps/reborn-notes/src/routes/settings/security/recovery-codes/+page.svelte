<script lang="ts">
  import { API_BASE } from '$lib/utils/api-base';
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/utils/auth-fetch';
  import {
    ShieldCheck,
    ShieldAlert,
    Download,
    Copy,
    Check,
    RefreshCw,
    AlertTriangle
  } from '@lucide/svelte';
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
    Separator
  } from '@reborn/ui';
  import { toast } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';
  import { t } from '$lib/stores/i18n.store';

  const logger = createLogger('RecoveryCodesPage');

  type CodesStatus = {
    hasCodesGenerated: boolean;
    totalCount: number;
    usedCount: number;
    availableCount: number;
    generatedAt: string | null;
  };

  let isLoading = $state(true);
  let isGenerating = $state(false);
  let status = $state<CodesStatus | null>(null);
  let newCodes = $state<string[]>([]);
  let showConfirmRegenerate = $state(false);
  let copiedIndex = $state<number | null>(null);
  let error = $state<string | null>(null);

  async function fetchStatus() {
    try {
      const response = await authFetch(`${API_BASE}/auth/recovery-codes`);
      const data = await response.json();
      if (data.success) {
        status = data.data;
      } else {
        error = $t('security.recovery_codes.fetch_error');
      }
    } catch (err: unknown) {
      logger.error('Failed to fetch recovery codes status:', err);
      error = $t('security.recovery_codes.connection_error');
    } finally {
      isLoading = false;
    }
  }

  async function generateCodes() {
    isGenerating = true;
    showConfirmRegenerate = false;
    error = null;
    try {
      const response = await authFetch(`${API_BASE}/auth/recovery-codes`, {
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        newCodes = data.data.codes;
        await fetchStatus();
        toast.success(
          $t('security.recovery_codes.generated_success', {
            values: { count: data.data.codes.length }
          })
        );
      } else {
        error = $t('security.recovery_codes.generate_error');
      }
    } catch (err: unknown) {
      logger.error('Failed to generate recovery codes:', err);
      error = $t('security.recovery_codes.connection_error');
    } finally {
      isGenerating = false;
    }
  }

  function downloadCodes() {
    if (!newCodes.length) return;
    const content = [
      $t('security.recovery_codes.file_header'),
      `${$t('security.recovery_codes.file_generated')} ${new Date().toLocaleString('pl-PL')}`,
      '',
      $t('security.recovery_codes.file_warning'),
      '',
      ...newCodes.map((code, i) => `${i + 1}. ${code}`)
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reborn-notes-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyCode(code: string, index: number) {
    try {
      await navigator.clipboard.writeText(code);
      copiedIndex = index;
      setTimeout(() => (copiedIndex = null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function copyAllCodes() {
    if (!newCodes.length) return;
    try {
      await navigator.clipboard.writeText(newCodes.join('\n'));
      toast.success($t('security.recovery_codes.copied'));
    } catch {
      /* clipboard unavailable */
    }
  }

  onMount(() => {
    fetchStatus();
  });
</script>

<svelte:head>
  <title>{$t('security.recovery_codes.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('security.recovery_codes.title')} backHref="/settings">
  <div class="space-y-6">
    <!-- Info -->
    <Alert>
      <ShieldCheck class="h-4 w-4" />
      <AlertDescription>
        {$t('security.recovery_codes.info')}
      </AlertDescription>
    </Alert>

    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    {#if isLoading}
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center justify-center py-8">
            <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    {:else}
      <!-- Status card -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            {#if status?.availableCount === 0 && status?.hasCodesGenerated}
              <ShieldAlert class="h-4 w-4 text-destructive" />
            {:else}
              <ShieldCheck class="h-4 w-4 text-muted-foreground" />
            {/if}
            {$t('security.recovery_codes.codes_title')}
          </CardTitle>
          <CardDescription>
            {#if !status?.hasCodesGenerated}
              {$t('security.recovery_codes.no_codes')}
            {:else if status.availableCount === 0}
              {$t('security.recovery_codes.all_used')}
            {:else}
              {$t('security.recovery_codes.codes_available', {
                values: { available: status.availableCount, total: status.totalCount }
              })}
            {/if}
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          {#if !status?.hasCodesGenerated}
            <!-- No codes yet -->
            <Button onclick={generateCodes} disabled={isGenerating} class="w-full sm:w-auto">
              {isGenerating
                ? $t('security.recovery_codes.generating')
                : $t('security.recovery_codes.generate')}
            </Button>
          {:else if !showConfirmRegenerate}
            <!-- Has codes — show regenerate option -->
            <Button
              variant="outline"
              onclick={() => (showConfirmRegenerate = true)}
              disabled={isGenerating}
              class="w-full sm:w-auto"
            >
              <RefreshCw class="h-4 w-4 mr-2" />
              {$t('security.recovery_codes.regenerate')}
            </Button>
          {:else}
            <!-- Confirm regenerate -->
            <Alert variant="destructive">
              <AlertTriangle class="h-4 w-4" />
              <AlertDescription>
                {$t('security.recovery_codes.regen_warning')}
              </AlertDescription>
            </Alert>
            <div class="flex gap-2 flex-wrap">
              <Button variant="destructive" onclick={generateCodes} disabled={isGenerating}>
                {isGenerating
                  ? $t('security.recovery_codes.generating')
                  : $t('security.recovery_codes.confirm_regen')}
              </Button>
              <Button
                variant="outline"
                onclick={() => (showConfirmRegenerate = false)}
                disabled={isGenerating}
              >
                {$t('security.recovery_codes.cancel')}
              </Button>
            </div>
          {/if}
        </CardContent>
      </Card>

      <!-- New codes — shown once after generation -->
      {#if newCodes.length > 0}
        <Card class="border-primary/50">
          <CardHeader>
            <CardTitle class="text-base text-primary">
              {$t('security.recovery_codes.save_codes')}
            </CardTitle>
            <CardDescription>
              {$t('security.recovery_codes.codes_generated', {
                values: { count: newCodes.length }
              })}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <!-- Code grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {#each newCodes as code, i}
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
          </CardContent>
        </Card>
      {/if}
    {/if}
  </div>
</SettingsLayout>
