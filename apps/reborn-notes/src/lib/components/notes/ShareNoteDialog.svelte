<script lang="ts">
  import { API_BASE } from '$lib/utils/api-base';
  import { getShareBase } from '$lib/utils/share-base';
  import { shareLink } from '$lib/utils/native-share';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Input,
    Label,
    toastStore
  } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { authFetch } from '$lib/utils/auth-fetch';
  import * as NoteService from '$lib/services/note.service';
  import { sharesStore } from '$lib/stores/shares.store';
  import {
    cryptoManager,
    generateSnapshotKey,
    exportKeyToBase64url,
    encryptSnapshotPayload,
    buildShareUrl
  } from '@reborn/crypto';
  import { Eye, EyeOff } from '@lucide/svelte';
  import {
    SHARE_EXPIRY_PRESETS,
    SHARE_MAX_ACCESS_COUNT_LIMIT,
    SNAPSHOT_PAYLOAD_VERSION,
    SHARE_SENDER_LABEL_MAX_LENGTH,
    SHARE_DISPLAY_NAME_MAX_LENGTH,
    type CreateShareResponse,
    type SharedSnapshotNotePayload
  } from '@reborn/types';

  type ExpiryPreset = keyof typeof SHARE_EXPIRY_PRESETS;
  type Stage = 'form' | 'creating' | 'success' | 'error';

  let {
    open = $bindable(false),
    noteId,
    noteTitle = ''
  }: {
    open: boolean;
    noteId: string;
    noteTitle?: string;
  } = $props();

  let stage = $state<Stage>('form');
  let expiry = $state<ExpiryPreset>('7d');
  let senderLabel = $state('');
  let displayName = $state('');
  let passwordEnabled = $state(false);
  let password = $state('');
  let passwordConfirm = $state('');
  let showPassword = $state(false);
  let showPasswordConfirm = $state(false);
  let maxOpensUnlimited = $state(true);
  let maxOpens = $state<number | null>(null);
  let errorMessage = $state('');
  let resultUrl = $state('');

  function resetForm() {
    stage = 'form';
    expiry = '7d';
    senderLabel = '';
    displayName = '';
    passwordEnabled = false;
    password = '';
    passwordConfirm = '';
    showPassword = false;
    showPasswordConfirm = false;
    maxOpensUnlimited = true;
    maxOpens = null;
    errorMessage = '';
    resultUrl = '';
  }

  $effect(() => {
    if (!open) resetForm();
  });

  function validate(): string | null {
    if (passwordEnabled) {
      if (password.length < 8) return $t('share.create.password_too_short');
      if (password !== passwordConfirm) return $t('share.create.password_mismatch');
    }
    if (!maxOpensUnlimited) {
      if (
        maxOpens === null ||
        !Number.isInteger(maxOpens) ||
        maxOpens < 1 ||
        maxOpens > SHARE_MAX_ACCESS_COUNT_LIMIT
      ) {
        return $t('share.create.max_opens_invalid');
      }
    }
    return null;
  }

  async function handleCreate() {
    if (!navigator.onLine) {
      errorMessage = $t('share.create.offline_warning');
      stage = 'error';
      return;
    }
    const validation = validate();
    if (validation) {
      errorMessage = validation;
      stage = 'error';
      return;
    }
    stage = 'creating';
    errorMessage = '';

    try {
      const note = await NoteService.getNote(noteId);
      if (!note) throw new Error('Note not found');

      // Defense-in-depth: snapshot payload is intentionally minimal. We drop
      // note metadata (is_starred, is_pinned, tags, created_at, updated_at)
      // entirely - none of those fields are rendered for the recipient, and
      // shipping them would leak personal organisational state (favourites,
      // pinning, taxonomy, editing patterns) once the recipient decrypts.
      // See SharedSnapshotNotePayload doc comment for the wider rationale.
      const payload: SharedSnapshotNotePayload = {
        type: 'note',
        v: SNAPSHOT_PAYLOAD_VERSION,
        title: note.title ?? '',
        content: note.content ?? '',
        shared_at: new Date().toISOString(),
        shared_by_label: senderLabel.trim() || undefined,
        display_name: displayName.trim() || undefined,
        source_id: noteId
      };

      const snapshotKey = await generateSnapshotKey();
      const payloadEncrypted = await encryptSnapshotPayload(payload, snapshotKey);
      const keyBase64url = await exportKeyToBase64url(snapshotKey);
      const ownerKeyWrapped = await cryptoManager.encryptString(keyBase64url);

      const expirySeconds = SHARE_EXPIRY_PRESETS[expiry];
      const res = await authFetch(`${API_BASE}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload_encrypted: payloadEncrypted,
          owner_key_wrapped: ownerKeyWrapped,
          expires_in_seconds: expirySeconds,
          password: passwordEnabled ? password : undefined,
          max_access_count: maxOpensUnlimited ? null : maxOpens
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 413 && body.error === 'QUOTA_EXCEEDED') {
          throw new Error($t('share.create.quota_exceeded'));
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { success: boolean; data: CreateShareResponse };
      resultUrl = buildShareUrl(
        getShareBase(),
        json.data.slug,
        keyBase64url,
        SNAPSHOT_PAYLOAD_VERSION
      );
      void sharesStore.refresh();
      stage = 'success';
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
      stage = 'error';
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(resultUrl);
      toastStore.success($t('share.create.copied'));
    } catch {
      toastStore.error($t('share.create.copy_failed'));
    }
  }

  // Native build only: open the OS share sheet. Web keeps clipboard-only (the
  // `{#if isNative}` branch and `shareLink` are dead-code-eliminated on web).
  const isNative = __REBORN_NATIVE__;

  async function handleShare() {
    const ok = await shareLink({
      url: resultUrl,
      title: noteTitle || $t('share.note.dialog_header'),
      dialogTitle: $t('share.create.share_sheet_title')
    });
    if (!ok) await handleCopy(); // plugin unavailable -> fall back to clipboard
  }

  function close() {
    open = false;
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$t('share.note.dialog_header')}</DialogTitle>
      {#if noteTitle}
        <DialogDescription>{noteTitle}</DialogDescription>
      {/if}
    </DialogHeader>

    {#if stage === 'form' || stage === 'creating' || stage === 'error'}
      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <Label for="share-expiry">{$t('share.create.expires_label')}</Label>
          <select
            id="share-expiry"
            bind:value={expiry}
            class="rounded-md border bg-background px-3 py-2 text-sm"
            disabled={stage === 'creating'}
          >
            <option value="1d">{$t('share.create.expires.1d')}</option>
            <option value="7d">{$t('share.create.expires.7d')}</option>
            <option value="30d">{$t('share.create.expires.30d')}</option>
            <option value="never">{$t('share.create.expires.never')}</option>
          </select>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="share-max-opens">{$t('share.create.max_opens_label')}</Label>
          <div class="flex items-center gap-2">
            <Input
              id="share-max-opens"
              type="number"
              min="1"
              max={SHARE_MAX_ACCESS_COUNT_LIMIT}
              step="1"
              bind:value={maxOpens}
              placeholder={$t('share.create.max_opens_placeholder')}
              disabled={stage === 'creating' || maxOpensUnlimited}
              class="w-32"
            />
            <label class="flex items-center gap-2 text-sm whitespace-nowrap">
              <input
                type="checkbox"
                bind:checked={maxOpensUnlimited}
                disabled={stage === 'creating'}
              />
              {$t('share.create.max_opens_unlimited')}
            </label>
          </div>
          <p class="text-xs text-muted-foreground">{$t('share.create.max_opens_hint')}</p>
          {#if !maxOpensUnlimited && maxOpens === 1}
            <p class="text-xs text-muted-foreground">
              {$t('share.create.max_opens_self_destruct_hint')}
            </p>
          {/if}
        </div>

        <div class="flex flex-col gap-2">
          <Label for="share-display-name">{$t('share.create.display_name_label')}</Label>
          <Input
            id="share-display-name"
            bind:value={displayName}
            placeholder={noteTitle || $t('share.create.display_name_placeholder')}
            maxlength={SHARE_DISPLAY_NAME_MAX_LENGTH}
            disabled={stage === 'creating'}
          />
          <p class="text-xs text-muted-foreground">{$t('share.create.display_name_hint')}</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="share-sender">{$t('share.create.sender_label')}</Label>
          <Input
            id="share-sender"
            bind:value={senderLabel}
            placeholder={$t('share.create.sender_label_placeholder')}
            maxlength={SHARE_SENDER_LABEL_MAX_LENGTH}
            disabled={stage === 'creating'}
          />
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            bind:checked={passwordEnabled}
            disabled={stage === 'creating'}
          />
          {$t('share.create.password_toggle')}
        </label>

        {#if passwordEnabled}
          <div class="flex flex-col gap-2">
            <div class="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                placeholder={$t('share.create.password_placeholder')}
                autocomplete="new-password"
                disabled={stage === 'creating'}
                class="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onclick={() => (showPassword = !showPassword)}
                disabled={stage === 'creating'}
                tabindex={-1}
              >
                {#if showPassword}
                  <EyeOff class="h-4 w-4 text-muted-foreground" />
                {:else}
                  <Eye class="h-4 w-4 text-muted-foreground" />
                {/if}
              </Button>
            </div>
            <div class="relative">
              <Input
                type={showPasswordConfirm ? 'text' : 'password'}
                bind:value={passwordConfirm}
                placeholder={$t('share.create.password_confirm_placeholder')}
                autocomplete="new-password"
                disabled={stage === 'creating'}
                class="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onclick={() => (showPasswordConfirm = !showPasswordConfirm)}
                disabled={stage === 'creating'}
                tabindex={-1}
              >
                {#if showPasswordConfirm}
                  <EyeOff class="h-4 w-4 text-muted-foreground" />
                {:else}
                  <Eye class="h-4 w-4 text-muted-foreground" />
                {/if}
              </Button>
            </div>
          </div>
        {/if}

        {#if stage === 'error' && errorMessage}
          <p class="text-sm text-destructive">{errorMessage}</p>
        {/if}
      </div>

      <DialogFooter>
        <Button variant="outline" onclick={close} disabled={stage === 'creating'}>
          {$t('share.create.close_cta')}
        </Button>
        <Button onclick={handleCreate} disabled={stage === 'creating'}>
          {stage === 'creating' ? $t('share.create.creating') : $t('share.create.cta')}
        </Button>
      </DialogFooter>
    {:else if stage === 'success'}
      <div class="flex flex-col gap-4 py-2">
        <p class="text-sm text-muted-foreground">{$t('share.create.success_title')}</p>
        <Input value={resultUrl} readonly class="font-mono text-xs" />
      </div>
      <DialogFooter>
        <Button variant="outline" onclick={close}>{$t('share.create.close_cta')}</Button>
        {#if isNative}
          <Button variant="outline" onclick={handleCopy}>{$t('share.create.copy_link')}</Button>
          <Button onclick={handleShare}>{$t('share.create.share_cta')}</Button>
        {:else}
          <Button onclick={handleCopy}>{$t('share.create.copy_link')}</Button>
        {/if}
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
