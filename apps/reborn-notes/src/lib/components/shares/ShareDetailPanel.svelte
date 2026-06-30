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
    Eye,
    Ellipsis,
    Download,
    ClipboardCopy,
    FileClock,
    FileText,
    FileX2
  } from '@lucide/svelte';
  import { t, locale } from '$lib/stores/i18n.store';
  import { shareLink } from '$lib/utils/native-share';
  import { copyText } from '$lib/utils/clipboard';
  import {
    toastStore,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator
  } from '@reborn/ui';
  import ConfirmDialog from '$lib/components/shared/ConfirmDialog.svelte';
  import NoteSnapshotView from '$lib/components/notes/NoteSnapshotView.svelte';
  import { exportMarkdownString } from '$lib/services/export-import.service';
  import { sharesStore, activeShareId } from '$lib/stores/shares.store';
  import { notesStore } from '$lib/stores/notes.store';
  import { formatExpiryRelative } from '$lib/utils/expiry-format';
  import type { OwnShareListItem } from '@reborn/types';

  let {
    shareId,
    onback,
    onopensource
  }: {
    shareId: string;
    onback?: () => void;
    onopensource?: (sourceId: string) => void;
  } = $props();

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

  // Stale hint: load the source note (by the id baked into the encrypted payload)
  // only to read its updated_at, and compare it to when the snapshot was taken.
  // loadNote returns null when the note isn't on this device (or was deleted) ->
  // no badge. Archived (trashed) notes are treated as "gone", so we suppress the
  // badge rather than flag a trash-induced bump. NOTE: updated_at also moves on
  // non-content edits (pin / move), so this is an informational hint, not a proof
  // the shared text changed.
  const sourceId = $derived(entry?.payload.source_id ?? null);
  let sourceUpdatedAt = $state<string | null>(null);
  // 'loading' until the lookup resolves, then 'open' (live note present on this
  // device, can jump to it) or 'gone' (deleted, never synced here, or trashed).
  // Same gate as the stale hint above: a trashed note is treated as gone. Drives
  // the "Open source note" row - an enabled jump vs a visible "no longer
  // available" reason (shown inline, not hover-only, so it reads on mobile).
  let sourceNoteState = $state<'loading' | 'open' | 'gone'>('loading');
  $effect(() => {
    const sid = sourceId;
    sourceUpdatedAt = null;
    sourceNoteState = 'loading';
    if (!sid) {
      sourceNoteState = 'gone';
      return;
    }
    let cancelled = false;
    void notesStore.loadNote(sid).then((n) => {
      if (cancelled) return;
      if (n && !n.is_archived) {
        sourceUpdatedAt = n.updated_at;
        sourceNoteState = 'open';
      } else {
        sourceUpdatedAt = null;
        sourceNoteState = 'gone';
      }
    });
    return () => {
      cancelled = true;
    };
  });

  // Delegate the actual navigation to the page (activeSection/activeNoteId live
  // there): switch to All notes and open the live source note. Guarded so a click
  // during the brief 'loading' window or on a gone note is a no-op here - the
  // page handler also re-validates as the source of truth.
  function openSourceNote() {
    const sid = sourceId;
    if (!sid || sourceNoteState !== 'open') return;
    onopensource?.(sid);
  }
  const snapshotStale = $derived(
    !!(
      sourceUpdatedAt
      && entry?.payload.shared_at
      && new Date(sourceUpdatedAt).getTime() > new Date(entry.payload.shared_at).getTime()
    )
  );

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
      : `${s.access_count} (${$t('share.list.opens_unlimited')})`;
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

  // Copy / export the FROZEN snapshot markdown (entry.payload.content) - the exact
  // text that was shared, not the live note. No frontmatter (export), no server hit.
  async function copyMarkdown() {
    if (!entry) return;
    if (await copyText(entry.payload.content)) toastStore.success($t('share.list.copied_markdown'));
    else toastStore.error($t('share.create.copy_failed'));
  }

  async function exportMarkdown() {
    if (!entry) return;
    const name =
      entry.payload.display_name?.trim() || entry.payload.title || $t('share.list.untitled');
    try {
      await exportMarkdownString(name, entry.payload.content);
    } catch {
      toastStore.error($t('notes.export_failed'));
    }
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
      class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground
             transition-colors hover:bg-accent hover:text-foreground"
      aria-label={$t('nav.back')}
    >
      <ArrowLeft class="h-5 w-5" />
    </button>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{headline}</p>
      <p class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{$t('share.list.snapshot_eyebrow')}</span>
        {#if share?.has_password}
          <span class="inline-flex items-center gap-0.5">
            <Lock class="h-3 w-3" />{$t('share.list.password_protected')}
          </span>
        {/if}
      </p>
    </div>
    <!-- Copy link stays inline + labelled: it is the primary, most-used action.
         The rarer / destructive actions live in the kebab, where every item is
         labelled (so nothing reads as an icon-only guess) and the header stays
         uncluttered on the narrow mobile layout. -->
    {#if entry}
      <button
        type="button"
        onclick={copyUrl}
        class="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm
               text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={$t('share.create.copy_link')}
      >
        <Copy class="h-4 w-4" />
        <span class="hidden md:inline">{$t('share.create.copy_link')}</span>
      </button>
    {/if}
    {#if entry || (share && !share.revoked_at)}
      <DropdownMenu>
        <DropdownMenuTrigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              title={$t('share.list.column.actions')}
              aria-label={$t('share.list.column.actions')}
              class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground
                     transition-colors hover:bg-accent hover:text-foreground"
            >
              <Ellipsis class="h-5 w-5" />
            </button>
          {/snippet}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-48">
          {#if entry}
            <!-- Navigational: jump to the live source note. Top of the menu,
                 separated from the snapshot/content actions below it and the
                 destructive Revoke at the bottom. When the note was deleted or
                 trashed the item is disabled and its label becomes the reason, so
                 it reads in the open menu without a hover-only tooltip. -->
            {#if sourceNoteState === 'gone'}
              <DropdownMenuItem disabled>
                <FileX2 class="mr-2 h-4 w-4" />{$t('share.list.source_note_deleted')}
              </DropdownMenuItem>
            {:else}
              <DropdownMenuItem disabled={sourceNoteState !== 'open'} onclick={openSourceNote}>
                <FileText class="mr-2 h-4 w-4" />{$t('share.list.open_source_note')}
              </DropdownMenuItem>
            {/if}
            <DropdownMenuSeparator />
            {#if isNative}
              <DropdownMenuItem onclick={shareUrl}>
                <Share2 class="mr-2 h-4 w-4" />{$t('share.create.share_cta')}
              </DropdownMenuItem>
            {/if}
            <DropdownMenuItem onclick={exportMarkdown}>
              <Download class="mr-2 h-4 w-4" />{$t('share.list.export_markdown')}
            </DropdownMenuItem>
            <DropdownMenuItem onclick={copyMarkdown}>
              <ClipboardCopy class="mr-2 h-4 w-4" />{$t('share.list.copy_markdown')}
            </DropdownMenuItem>
          {/if}
          {#if share && !share.revoked_at}
            <!-- Revoke kills the public link permanently - not a recoverable trash
                 like a note. Separated + destructive-coloured at the bottom. -->
            {#if entry}<DropdownMenuSeparator />{/if}
            <DropdownMenuItem
              class="text-destructive focus:text-destructive"
              disabled={revoking}
              onclick={() => (confirmRevokeOpen = true)}
            >
              <Link2Off class="mr-2 h-4 w-4" />{$t('share.list.revoke_action')}
            </DropdownMenuItem>
          {/if}
        </DropdownMenuContent>
      </DropdownMenu>
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
          {#if urlShown}
            <div class="relative flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
              <button
                type="button"
                class="inline-flex w-fit cursor-pointer items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                onclick={() => (urlShown = false)}
              >
                <ChevronUp class="h-3 w-3" />{$t('share.list.hide_link')}
              </button>
              <!-- Copy affordance pinned top-right, mirroring note code blocks. -->
              <button
                type="button"
                onclick={copyUrl}
                class="absolute right-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border
                       bg-background text-muted-foreground opacity-70 transition hover:text-foreground hover:opacity-100"
                aria-label={$t('share.create.copy_link')}
                title={$t('share.create.copy_link')}
              >
                <Copy class="h-3.5 w-3.5" />
              </button>
              <p class="break-all pr-9 font-mono text-xs text-muted-foreground">{entry.url}</p>
              <!-- Privacy nudge: the link carries the decryption key in its
                   fragment, so anyone with it can read the snapshot. -->
              <p class="mt-1 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                <Lock class="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{$t('share.list.link_key_warning')}</span>
              </p>
            </div>
          {:else}
            <!-- Collapsed: the whole block is the expand affordance (full-width,
                 pointer cursor + hover), not just the small label - bigger target
                 and signals interactivity like a link. -->
            <button
              type="button"
              onclick={() => (urlShown = true)}
              class="flex w-full cursor-pointer items-center gap-1 rounded-lg border bg-muted/30 p-3
                     text-[11px] uppercase tracking-wider text-muted-foreground transition-colors
                     hover:bg-muted/50 hover:text-foreground"
            >
              <ChevronDown class="h-3 w-3" />{$t('share.list.show_link')}
            </button>
          {/if}
        {/if}

        <!-- Source note changed since the snapshot was frozen (informational). -->
        {#if snapshotStale}
          <div
            class="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10
                   px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
          >
            <FileClock class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{$t('share.list.snapshot_stale')}</span>
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
              {#if share.expires_at}
                {@const rel = formatExpiryRelative(share.expires_at, $locale ?? 'en')}
                {formatDate(share.expires_at)}
                {#if rel?.expired}
                  <span class="font-normal text-destructive">({$t('share.list.expired')})</span>
                {:else if rel}
                  <span class="font-normal text-muted-foreground">({rel.text})</span>
                {/if}
              {:else}
                {$t('share.create.expires.never')}
              {/if}
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
