<script lang="ts">
  import {
    ArrowLeft,
    Copy,
    Share2,
    Link2Off,
    Lock,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Eye
  } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import { shareLink } from '$lib/utils/native-share';
  import { copyText } from '$lib/utils/clipboard';
  import { toastStore } from '@reborn/ui';
  import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
  import NoteSnapshotView from '$lib/components/notes/NoteSnapshotView.svelte';
  import { sharesStore, activeShareId } from '$lib/stores/shares.store';
  import type { OwnShareListItem } from '@reborn/types';

  let { shareId, onback }: { shareId: string; onback?: () => void } = $props();

  const storeState = $derived($sharesStore);
  const share = $derived<OwnShareListItem | null>(
    storeState.shares.find((s) => s.id === shareId) ?? null
  );
  // Already decrypted locally by the store (owner_key_wrapped + master key). The
  // preview reads this plaintext - it never calls the public /s endpoint, so it
  // consumes no access slot (ZK-safe, free).
  const entry = $derived(storeState.decoded[shareId] ?? null);
  const hasDecryptError = $derived(storeState.decryptErrors.has(shareId));

  let urlShown = $state(false);
  let revoking = $state(false);
  let confirmRevokeOpen = $state(false);

  // Reset the per-share UI toggles when a different share is selected.
  $effect(() => {
    void shareId;
    urlShown = false;
  });

  // Native build only: OS share sheet. Web is copy-only (DCE'd via the define).
  const isNative = __REBORN_NATIVE__;

  const headline = $derived(
    entry
      ? entry.payload.display_name?.trim() || entry.payload.title || $t('share.list.untitled')
      : $t('share.list.title')
  );

  function formatDate(iso: string | null): string {
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

  async function copyUrl() {
    if (!entry?.url) return;
    if (await copyText(entry.url)) toastStore.success($t('share.create.copied'));
    else toastStore.error($t('share.create.copy_failed'));
  }

  async function shareUrl() {
    if (!entry?.url) return;
    const ok = await shareLink({
      url: entry.url,
      title: entry.payload.title || $t('share.list.untitled'),
      dialogTitle: $t('share.create.share_sheet_title')
    });
    if (!ok) await copyUrl();
  }

  async function doRevoke() {
    if (!share) return;
    revoking = true;
    const ok = await sharesStore.revoke(share.slug);
    revoking = false;
    if (ok) {
      toastStore.success($t('share.list.revoked_toast'));
      activeShareId.set(null);
      onback?.();
    } else {
      toastStore.error($t('share.list.revoke_error'));
    }
  }

  function close() {
    activeShareId.set(null);
    onback?.();
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header bar: back + title + actions -->
  <header
    class="flex min-h-[calc(3rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1
           border-b border-border/60 px-3 md:px-4 pt-[env(safe-area-inset-top,0px)]"
  >
    <button
      type="button"
      onclick={close}
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground
             transition-colors hover:bg-accent hover:text-foreground"
      aria-label={$t('nav.back')}
    >
      <ArrowLeft class="h-5 w-5" />
    </button>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{headline}</p>
      <p class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{$t('share.list.type.note')}</span>
        {#if share?.has_password}
          <span class="inline-flex items-center gap-0.5">
            <Lock class="h-3 w-3" />{$t('share.list.password_protected')}
          </span>
        {/if}
      </p>
    </div>
    <!-- Labelled on desktop (the header has room and icon-only actions read as
         ambiguous), icon-only on the cramped mobile header. -->
    {#if entry}
      <button
        type="button"
        onclick={copyUrl}
        class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm
               text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={$t('share.create.copy_link')}
      >
        <Copy class="h-4 w-4" />
        <span class="hidden md:inline">{$t('share.create.copy_link')}</span>
      </button>
      {#if isNative}
        <button
          type="button"
          onclick={shareUrl}
          class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm
                 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={$t('share.create.share_cta')}
        >
          <Share2 class="h-4 w-4" />
          <span class="hidden md:inline">{$t('share.create.share_cta')}</span>
        </button>
      {/if}
    {/if}
    {#if share && !share.revoked_at}
      <!-- Revoke kills the public link permanently - not a recoverable trash like a
           note. A Link2Off glyph + explicit label disambiguate it from note delete. -->
      <button
        type="button"
        disabled={revoking}
        onclick={() => (confirmRevokeOpen = true)}
        class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm
               text-destructive transition-colors hover:bg-destructive/10
               disabled:pointer-events-none disabled:opacity-50"
        aria-label={$t('share.list.revoke_action')}
      >
        <Link2Off class="h-4 w-4" />
        <span class="hidden md:inline">{$t('share.list.revoke_action')}</span>
      </button>
    {/if}
  </header>

  <!-- Body -->
  <div class="flex-1 overflow-y-auto">
    {#if !share}
      <div
        class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
      >
        <AlertTriangle class="h-5 w-5 text-amber-500" aria-hidden="true" />
        <p>{$t('share.list.empty')}</p>
      </div>
    {:else}
      <div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 md:px-6 py-4">
        <!-- Public link URL (hidden by default) -->
        {#if entry}
          <div class="relative flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
            <button
              type="button"
              class="inline-flex w-fit items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              onclick={() => (urlShown = !urlShown)}
            >
              {#if urlShown}
                <ChevronUp class="h-3 w-3" />{$t('share.list.hide_link')}
              {:else}
                <ChevronDown class="h-3 w-3" />{$t('share.list.show_link')}
              {/if}
            </button>
            {#if urlShown}
              <!-- Copy affordance pinned top-right, mirroring note code blocks. -->
              <button
                type="button"
                onclick={copyUrl}
                class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border
                       bg-background text-muted-foreground opacity-70 transition hover:text-foreground hover:opacity-100"
                aria-label={$t('share.create.copy_link')}
                title={$t('share.create.copy_link')}
              >
                <Copy class="h-3.5 w-3.5" />
              </button>
              <p class="break-all pr-9 font-mono text-xs text-muted-foreground">{entry.url}</p>
            {/if}
          </div>
        {/if}

        <!-- Metadata -->
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <div>
            <dt class="text-muted-foreground">{$t('share.list.column.created')}</dt>
            <dd class="mt-0.5 font-medium">{formatDate(share.created_at)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{$t('share.list.column.expires')}</dt>
            <dd class="mt-0.5 font-medium">
              {share.expires_at ? formatDate(share.expires_at) : $t('share.create.expires.never')}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{$t('share.list.column.access_count')}</dt>
            <dd class="mt-0.5 font-medium">{formatOpens(share)}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">{$t('share.list.column.last_accessed')}</dt>
            <dd class="mt-0.5 font-medium">
              {share.last_accessed_at ? formatDate(share.last_accessed_at) : '-'}
            </dd>
          </div>
        </dl>

        <!-- Snapshot preview (what the recipient sees) -->
        <div class="rounded-lg border p-4">
          <p class="mb-3 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Eye class="h-3.5 w-3.5" />{$t('share.list.preview_dialog_title')}
          </p>
          {#if entry}
            <NoteSnapshotView payload={entry.payload} showHeader={false} />
            <p class="mt-4 text-xs italic text-muted-foreground">{$t('share.list.preview_hint')}</p>
          {:else if hasDecryptError}
            <p class="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <AlertTriangle class="h-4 w-4" />{$t('share.list.decrypt_failed')}
            </p>
          {:else}
            <p class="text-sm italic text-muted-foreground">{$t('share.list.decrypting')}</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={confirmRevokeOpen}
  title={$t('share.list.confirm_revoke_title')}
  description={$t('share.list.confirm_revoke_desc')}
  confirmText={$t('share.list.revoke_action')}
  destructive
  onConfirm={doRevoke}
/>
