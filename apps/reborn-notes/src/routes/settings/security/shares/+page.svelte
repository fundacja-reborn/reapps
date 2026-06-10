<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    RefreshCw,
    Trash2,
    Copy,
    Share2,
    Lock,
    FileText,
    Eye,
    ChevronDown,
    ChevronUp,
    AlertTriangle
  } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { shareLink } from '$lib/utils/native-share';
  import { copyText } from '$lib/utils/clipboard';
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
  import { type OwnShareListItem, type SharedSnapshotNotePayload } from '@reborn/types';
  import NoteSnapshotView from '$lib/components/notes/NoteSnapshotView.svelte';
  import {
    sharesStore,
    isShareInactive,
    isShareExhausted
  } from '$lib/stores/shares.store';

  let urlsVisible = new SvelteSet<string>();
  let previewing = $state<SharedSnapshotNotePayload | null>(null);
  let previewOpen = $state(false);
  let revoking = $state<string | null>(null);

  const storeState = $derived($sharesStore);
  const shares = $derived(storeState.shares);
  const decoded = $derived(storeState.decoded);
  const decryptErrors = $derived(storeState.decryptErrors);
  const isLoading = $derived(storeState.loading);
  const error = $derived(storeState.error);

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

  function formatOpens(s: OwnShareListItem): string {
    return s.max_access_count !== null
      ? `${s.access_count} / ${s.max_access_count}`
      : String(s.access_count);
  }

  async function copyUrl(id: string) {
    const url = decoded[id]?.url;
    if (!url) return;
    if (await copyText(url)) {
      toastStore.success($t('share.create.copied'));
    } else {
      toastStore.error($t('share.create.copy_failed'));
    }
  }

  // Native build only: open the OS share sheet. Web keeps copy-only (the button
  // and `shareLink` are dead-code-eliminated on web).
  const isNative = __REBORN_NATIVE__;

  async function shareUrl(id: string) {
    const entry = decoded[id];
    if (!entry?.url) return;
    const ok = await shareLink({
      url: entry.url,
      title: entry.payload.title || $t('share.list.untitled'),
      dialogTitle: $t('share.create.share_sheet_title')
    });
    if (!ok) await copyUrl(id); // plugin unavailable -> fall back to clipboard
  }

  function toggleUrl(id: string) {
    if (urlsVisible.has(id)) urlsVisible.delete(id);
    else urlsVisible.add(id);
  }

  function openPreview(id: string) {
    const item = decoded[id];
    if (!item) return;
    previewing = item.payload;
    previewOpen = true;
  }

  async function revoke(share: OwnShareListItem) {
    revoking = share.id;
    const ok = await sharesStore.revoke(share.slug);
    if (ok) {
      toastStore.success($t('share.list.revoked_toast'));
    } else {
      toastStore.error($t('share.list.revoke_error'));
    }
    revoking = null;
  }

  // Defense-in-depth: server already filters by snapshot_type but the client
  // double-checks against the actual payload type from the ciphertext.
  const visibleShares = $derived(
    shares.filter((s) => {
      if (s.snapshot_type === 'note') return true;
      if (s.snapshot_type === 'unknown') {
        return decoded[s.id]?.payload.type === 'note' || decryptErrors.has(s.id);
      }
      return false;
    })
  );

  onMount(() => {
    sharesStore.init();
    void sharesStore.refresh();
  });
</script>

<svelte:head>
  <title>{$t('share.list.title')} - re/notes</title>
</svelte:head>

<SettingsLayout title={$t('share.list.title')} backHref="/settings">
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon"
      onclick={() => sharesStore.refresh()}
      disabled={isLoading}
      aria-label="Refresh"
    >
      <RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin' : ''}" />
    </Button>
  {/snippet}

  <div class="space-y-4">
    {#if error}
      <Alert variant="destructive">
        <AlertDescription>{$t('share.list.error_load')}</AlertDescription>
      </Alert>
    {/if}

    {#if isLoading && visibleShares.length === 0}
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
        {@const exhausted = isShareExhausted(share)}
        {@const inactive = isShareInactive(share)}
        {@const urlShown = urlsVisible.has(share.id)}
        <Card class={inactive ? 'opacity-60' : ''}>
          <CardContent class="flex flex-col gap-3 px-4 py-3">
            <div class="flex items-start justify-between gap-2">
              <div class="flex min-w-0 flex-1 items-start gap-2">
                <FileText class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {$t('share.list.type.note')}
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
                  {#if isNative}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={$t('share.create.share_cta')}
                      onclick={() => shareUrl(share.id)}
                    >
                      <Share2 class="h-4 w-4" />
                    </Button>
                  {/if}
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
        <NoteSnapshotView payload={previewing} />
        <p class="text-xs italic text-muted-foreground">{$t('share.list.preview_hint')}</p>
      </div>
    {/if}
  </DialogContent>
</Dialog>
