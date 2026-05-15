<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/utils/auth-fetch';
  import {
    RefreshCw,
    Trash2,
    Copy,
    Lock,
    CheckSquare,
    Eye,
    ChevronDown,
    ChevronUp,
    AlertTriangle
  } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    SettingsLayout,
    Button,
    Alert,
    AlertDescription,
    Card,
    CardContent,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    toastStore
  } from '@reborn/ui';
  import { createLogger } from '@reborn/utils';
  import {
    cryptoManager,
    buildShareUrl,
    importKeyFromBase64url,
    decryptSnapshotPayload
  } from '@reborn/crypto';
  import {
    SNAPSHOT_PAYLOAD_VERSION,
    SharedSnapshotPayloadSchema,
    type OwnShareListItem,
    type SharedSnapshotTaskPayload
  } from '@reborn/types';
  import TaskSnapshotView from '$lib/components/tasks/TaskSnapshotView.svelte';

  const logger = createLogger('Task-SharesPage');

  type Decoded = {
    payload: SharedSnapshotTaskPayload;
    url: string;
  };

  let isLoading = $state(true);
  let revoking = $state<string | null>(null);
  let shares = $state<OwnShareListItem[]>([]);
  let decoded = $state<Record<string, Decoded>>({});
  let decryptErrors = $state<Set<string>>(new Set());
  let urlsVisible = $state<Set<string>>(new Set());
  let previewing = $state<SharedSnapshotTaskPayload | null>(null);
  let previewOpen = $state(false);
  let error = $state<string | null>(null);

  function formatDate(iso: string | null) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch {
      return iso;
    }
  }

  function isExhausted(s: OwnShareListItem): boolean {
    return s.max_access_count !== null && s.access_count >= s.max_access_count;
  }

  function isInactive(s: OwnShareListItem): boolean {
    if (s.revoked_at) return true;
    if (s.expires_at && new Date(s.expires_at) < new Date()) return true;
    return false;
  }

  function formatOpens(s: OwnShareListItem): string {
    return s.max_access_count !== null
      ? `${s.access_count} / ${s.max_access_count}`
      : String(s.access_count);
  }

  async function hydrate(items: OwnShareListItem[]) {
    if (!cryptoManager.isInitialized()) return;
    const nextDecoded: Record<string, Decoded> = {};
    const nextErrors = new Set<string>();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    await Promise.all(
      items.map(async (s) => {
        let rawKey: string;
        try {
          rawKey = await cryptoManager.decryptString(s.owner_key_wrapped);
        } catch (err) {
          logger.warn('Failed to unwrap share key:', err);
          nextErrors.add(s.id);
          return;
        }
        const url = buildShareUrl(`${origin}${base}`, s.slug, rawKey, SNAPSHOT_PAYLOAD_VERSION);
        try {
          const key = await importKeyFromBase64url(rawKey);
          const plaintext = await decryptSnapshotPayload(s.payload_encrypted, key);
          const parsed = SharedSnapshotPayloadSchema.safeParse(plaintext);
          if (!parsed.success || parsed.data.type !== 'task') {
            nextErrors.add(s.id);
            return;
          }
          nextDecoded[s.id] = { payload: parsed.data, url };
        } catch (err) {
          logger.warn('Failed to decrypt share payload:', err);
          nextErrors.add(s.id);
        }
      })
    );
    decoded = nextDecoded;
    decryptErrors = nextErrors;
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
      await hydrate(shares);
    } catch (err: unknown) {
      logger.error('Fetch shares failed:', err);
      error = $t('share.list.error_load');
    } finally {
      isLoading = false;
    }
  }

  async function copyUrl(id: string) {
    const url = decoded[id]?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toastStore.success($t('share.create.copied'));
    } catch {
      toastStore.error($t('share.create.copy_failed'));
    }
  }

  function toggleUrl(id: string) {
    const next = new Set(urlsVisible);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    urlsVisible = next;
  }

  function openPreview(id: string) {
    const item = decoded[id];
    if (!item) return;
    previewing = item.payload;
    previewOpen = true;
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

  // Defense-in-depth: server already filters by snapshot_type but the client
  // double-checks against the actual payload type from the ciphertext.
  const visibleShares = $derived(
    shares.filter((s) => {
      if (s.snapshot_type === 'task') return true;
      if (s.snapshot_type === 'unknown') {
        return decoded[s.id]?.payload.type === 'task' || decryptErrors.has(s.id);
      }
      return false;
    })
  );

  onMount(() => {
    fetchShares();
  });
</script>

<svelte:head>
  <title>{$t('share.list.title')} - re/task</title>
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
    {:else if visibleShares.length === 0}
      <Card>
        <CardContent class="px-4 py-8 text-center text-sm text-muted-foreground">
          {$t('share.list.empty')}
        </CardContent>
      </Card>
    {:else}
      {#each visibleShares as share (share.id)}
        {@const entry = decoded[share.id]}
        {@const hasDecryptError = decryptErrors.has(share.id)}
        {@const exhausted = isExhausted(share)}
        {@const inactive = isInactive(share)}
        {@const urlShown = urlsVisible.has(share.id)}
        <Card class={inactive ? 'opacity-60' : ''}>
          <CardContent class="flex flex-col gap-3 px-4 py-3">
            <div class="flex items-start justify-between gap-2">
              <div class="flex min-w-0 flex-1 items-start gap-2">
                <CheckSquare class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {$t('share.list.type.task')}
                    </span>
                    {#if share.has_password}
                      <span class="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <Lock class="h-3 w-3" />
                        {$t('share.list.password_protected')}
                      </span>
                    {/if}
                    {#if exhausted}
                      <span class="text-[10px] uppercase tracking-wider text-destructive">{$t('share.list.exhausted_label')}</span>
                    {:else if inactive}
                      <span class="text-[10px] uppercase tracking-wider text-destructive">{$t('share.list.revoked_label')}</span>
                    {/if}
                  </div>
                  {#if entry}
                    <p class="truncate text-sm font-medium">
                      {entry.payload.title || $t('share.list.untitled')}
                    </p>
                  {:else if hasDecryptError}
                    <p class="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <AlertTriangle class="h-3.5 w-3.5" />
                      {$t('share.list.decrypt_failed')}
                    </p>
                  {:else}
                    <p class="text-sm italic text-muted-foreground">{$t('share.list.decrypting')}</p>
                  {/if}
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                {#if entry && !inactive}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={$t('share.list.preview_action')}
                    onclick={() => openPreview(share.id)}
                  >
                    <Eye class="h-4 w-4" />
                  </Button>
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

            {#if entry && !inactive}
              <div class="flex flex-col gap-1">
                <button
                  type="button"
                  class="inline-flex w-fit items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  onclick={() => toggleUrl(share.id)}
                >
                  {#if urlShown}
                    <ChevronUp class="h-3 w-3" />
                    {$t('share.list.hide_link')}
                  {:else}
                    <ChevronDown class="h-3 w-3" />
                    {$t('share.list.show_link')}
                  {/if}
                </button>
                {#if urlShown}
                  <p class="break-all font-mono text-xs text-muted-foreground">{entry.url}</p>
                {/if}
              </div>
            {/if}

            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{$t('share.list.column.created')}: {formatDate(share.created_at)}</span>
              <span>
                {$t('share.list.column.expires')}:
                {share.expires_at ? formatDate(share.expires_at) : $t('share.create.expires.never')}
              </span>
              <span>{$t('share.list.column.access_count')}: {formatOpens(share)}</span>
              {#if share.last_accessed_at}
                <span>
                  {$t('share.list.column.last_accessed')}: {formatDate(share.last_accessed_at)}
                </span>
              {/if}
            </div>
          </CardContent>
        </Card>
      {/each}
    {/if}
  </div>
</SettingsLayout>

<Dialog bind:open={previewOpen}>
  <DialogContent class="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
    <DialogHeader class="flex-shrink-0 border-b px-6 py-4 pr-12">
      <DialogTitle>{$t('share.list.preview_dialog_title')}</DialogTitle>
    </DialogHeader>
    {#if previewing}
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        <TaskSnapshotView payload={previewing} />
        <p class="text-xs italic text-muted-foreground">{$t('share.list.preview_hint')}</p>
      </div>
    {/if}
  </DialogContent>
</Dialog>
