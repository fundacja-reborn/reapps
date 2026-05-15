<script lang="ts">
  import {
    RefreshCw,
    Trash2,
    Copy,
    Lock,
    CheckSquare,
    Eye,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    Plus
  } from '@lucide/svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '$lib/stores/i18n.store';
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    Button,
    Card,
    CardContent,
    toastStore
  } from '@reborn/ui';
  import {
    sharesStore,
    isShareInactive,
    isShareExhausted
  } from '$lib/stores/shares.store';
  import type { OwnShareListItem, SharedSnapshotTaskPayload } from '@reborn/types';
  import TaskSnapshotView from './TaskSnapshotView.svelte';

  let {
    open = $bindable(false),
    sourceId = null,
    title,
    onCreateNew
  }: {
    open: boolean;
    sourceId?: string | null;
    title?: string;
    onCreateNew?: () => void;
  } = $props();

  let urlsVisible = new SvelteSet<string>();
  let previewing = $state<SharedSnapshotTaskPayload | null>(null);
  let previewOpen = $state(false);
  let revoking = $state<string | null>(null);

  const storeState = $derived($sharesStore);
  const decoded = $derived(storeState.decoded);
  const decryptErrors = $derived(storeState.decryptErrors);
  const isLoading = $derived(storeState.loading);

  const visibleShares = $derived(
    storeState.shares.filter((s) => {
      const isTask = s.snapshot_type === 'task'
        || (s.snapshot_type === 'unknown'
          && (decoded[s.id]?.payload.type === 'task' || decryptErrors.has(s.id)));
      if (!isTask) return false;
      if (sourceId === null) return true;
      return decoded[s.id]?.payload.source_id === sourceId;
    })
  );

  function formatDate(iso: string | null) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
    try {
      await navigator.clipboard.writeText(url);
      toastStore.success($t('share.create.copied'));
    } catch {
      toastStore.error($t('share.create.copy_failed'));
    }
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
    if (ok) toastStore.success($t('share.list.revoked_toast'));
    else toastStore.error($t('share.list.revoke_error'));
    revoking = null;
  }

  $effect(() => {
    if (open) void sharesStore.refresh();
  });
</script>

<Dialog bind:open>
  <DialogContent class="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
    <DialogHeader class="flex-shrink-0 border-b px-6 py-4 pr-12">
      <DialogTitle>
        {title ?? (sourceId ? $t('share.manage.for_task_title') : $t('share.manage.dialog_title'))}
      </DialogTitle>
      {#if sourceId}
        <DialogDescription>
          {$t('share.manage.for_task_description')}
        </DialogDescription>
      {/if}
    </DialogHeader>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
      {#if onCreateNew && sourceId}
        <Button variant="outline" class="w-fit" onclick={onCreateNew}>
          <Plus class="mr-2 h-4 w-4" />
          {$t('share.manage.create_new_cta')}
        </Button>
      {/if}

      {#if isLoading && visibleShares.length === 0}
        <div class="flex justify-center py-8">
          <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      {:else if visibleShares.length === 0}
        <Card>
          <CardContent class="px-4 py-8 text-center text-sm text-muted-foreground">
            {sourceId ? $t('share.manage.empty_for_task') : $t('share.list.empty')}
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
                  <CheckSquare class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
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
  </DialogContent>
</Dialog>

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
