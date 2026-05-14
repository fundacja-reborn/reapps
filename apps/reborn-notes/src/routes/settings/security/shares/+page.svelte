<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/utils/auth-fetch';
  import { RefreshCw, Trash2, Copy, Lock } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    SettingsLayout,
    Button,
    Alert,
    AlertDescription,
    Card,
    CardContent,
    toastStore
  } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';
  import { cryptoManager, buildShareUrl } from '@reborn/crypto';
  import { SNAPSHOT_PAYLOAD_VERSION, type OwnShareListItem } from '@reborn/types';

  const logger = createLogger('Notes-SharesPage');

  let isLoading = $state(true);
  let revoking = $state<string | null>(null);
  let shares = $state<OwnShareListItem[]>([]);
  let urls = $state<Record<string, string>>({});
  let error = $state<string | null>(null);

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch {
      return iso;
    }
  }

  function isRevoked(s: OwnShareListItem): boolean {
    if (s.revoked_at) return true;
    if (s.expires_at && new Date(s.expires_at) < new Date()) return true;
    return false;
  }

  async function hydrateUrls(items: OwnShareListItem[]) {
    if (!cryptoManager.isInitialized()) return;
    const next: Record<string, string> = {};
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    await Promise.all(
      items.map(async (s) => {
        try {
          const key = await cryptoManager.decryptString(s.owner_key_wrapped);
          next[s.id] = buildShareUrl(`${origin}${base}`, s.slug, key, SNAPSHOT_PAYLOAD_VERSION);
        } catch (err) {
          logger.warn('Failed to unwrap share key:', err);
        }
      })
    );
    urls = next;
  }

  async function fetchShares() {
    isLoading = true;
    error = null;
    try {
      const res = await authFetch(`${base}/api/shares`);
      const data = await res.json();
      if (!data.success) {
        error = $t('share.list.error_load');
        return;
      }
      shares = data.data.shares as OwnShareListItem[];
      await hydrateUrls(shares);
    } catch (err: unknown) {
      logger.error('Fetch shares failed:', err);
      error = $t('share.list.error_load');
    } finally {
      isLoading = false;
    }
  }

  async function copyUrl(id: string) {
    const url = urls[id];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toastStore.success($t('share.create.copied'));
    } catch {
      toastStore.error($t('share.create.copy_failed'));
    }
  }

  async function revoke(share: OwnShareListItem) {
    revoking = share.id;
    try {
      const res = await authFetch(`${base}/api/shares/${share.slug}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Revoke failed');
      shares = shares.map((s) =>
        s.id === share.id ? { ...s, revoked_at: new Date().toISOString() } : s
      );
      toastStore.success($t('share.list.revoked_toast'));
    } catch (err: unknown) {
      logger.error('Revoke failed:', err);
      toastStore.error($t('share.list.revoke_error'));
    } finally {
      revoking = null;
    }
  }

  onMount(() => {
    fetchShares();
  });
</script>

<svelte:head>
  <title>{$t('share.list.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('share.list.title')} backHref="/settings">
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon"
      onclick={fetchShares}
      disabled={isLoading}
      aria-label="Refresh"
    >
      <RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin' : ''}" />
    </Button>
  {/snippet}

  <div class="space-y-4">
    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    {/if}

    {#if isLoading}
      <div class="flex justify-center py-12">
        <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    {:else if shares.length === 0}
      <Card>
        <CardContent class="px-4 py-8 text-center text-sm text-muted-foreground">
          {$t('share.list.empty')}
        </CardContent>
      </Card>
    {:else}
      {#each shares as share (share.id)}
        {@const url = urls[share.id]}
        {@const revoked = isRevoked(share)}
        <Card class={revoked ? 'opacity-60' : ''}>
          <CardContent class="flex flex-col gap-2 px-4 py-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                {#if share.has_password}
                  <Lock class="h-3.5 w-3.5" />
                  {$t('share.list.password_protected')}
                {/if}
                {#if revoked}
                  <span class="text-destructive">{$t('share.list.revoked_label')}</span>
                {/if}
              </div>
              <div class="flex gap-1">
                {#if !revoked && url}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={$t('share.create.copy_link')}
                    onclick={() => copyUrl(share.id)}
                  >
                    <Copy class="h-4 w-4" />
                  </Button>
                {/if}
                {#if !share.revoked_at}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={$t('share.list.revoke_action')}
                    disabled={revoking === share.id}
                    onclick={() => revoke(share)}
                  >
                    <Trash2 class="h-4 w-4 text-destructive" />
                  </Button>
                {/if}
              </div>
            </div>
            {#if url}
              <p class="break-all font-mono text-xs text-muted-foreground">{url}</p>
            {:else if !revoked}
              <p class="text-xs italic text-muted-foreground">{$t('share.list.no_local_key_hint')}</p>
            {/if}
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{$t('share.list.column.created')}: {formatDate(share.created_at)}</span>
              <span>
                {$t('share.list.column.expires')}:
                {share.expires_at ? formatDate(share.expires_at) : $t('share.create.expires.never')}
              </span>
              <span>{$t('share.list.column.access_count')}: {share.access_count}</span>
            </div>
          </CardContent>
        </Card>
      {/each}
    {/if}
  </div>
</SettingsLayout>
