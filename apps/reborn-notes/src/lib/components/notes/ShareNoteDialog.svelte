<script lang="ts">
  import { base } from '$app/paths';
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
  import {
    cryptoManager,
    generateSnapshotKey,
    exportKeyToBase64url,
    encryptSnapshotPayload,
    buildShareUrl
  } from '@reborn/crypto';
  import {
    SHARE_EXPIRY_PRESETS,
    SNAPSHOT_PAYLOAD_VERSION,
    SHARE_SENDER_LABEL_MAX_LENGTH,
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
  let passwordEnabled = $state(false);
  let password = $state('');
  let passwordConfirm = $state('');
  let errorMessage = $state('');
  let resultUrl = $state('');

  function resetForm() {
    stage = 'form';
    expiry = '7d';
    senderLabel = '';
    passwordEnabled = false;
    password = '';
    passwordConfirm = '';
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

      const payload: SharedSnapshotNotePayload = {
        type: 'note',
        v: SNAPSHOT_PAYLOAD_VERSION,
        title: note.title ?? '',
        content: note.content ?? '',
        metadata: {
          is_starred: note.is_starred,
          is_pinned: note.is_pinned,
          tags: note.tags,
          created_at: note.created_at,
          updated_at: note.updated_at
        },
        shared_at: new Date().toISOString(),
        shared_by_label: senderLabel.trim() || undefined
      };

      const snapshotKey = await generateSnapshotKey();
      const payloadEncrypted = await encryptSnapshotPayload(payload, snapshotKey);
      const keyBase64url = await exportKeyToBase64url(snapshotKey);
      const ownerKeyWrapped = await cryptoManager.encryptString(keyBase64url);

      const expirySeconds = SHARE_EXPIRY_PRESETS[expiry];
      const res = await authFetch(`${base}/api/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload_encrypted: payloadEncrypted,
          owner_key_wrapped: ownerKeyWrapped,
          expires_in_seconds: expirySeconds,
          password: passwordEnabled ? password : undefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { success: boolean; data: CreateShareResponse };
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      resultUrl = buildShareUrl(
        `${origin}${base}`,
        json.data.slug,
        keyBase64url,
        SNAPSHOT_PAYLOAD_VERSION
      );
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
            <Input
              type="password"
              bind:value={password}
              placeholder={$t('share.create.password_placeholder')}
              disabled={stage === 'creating'}
            />
            <Input
              type="password"
              bind:value={passwordConfirm}
              placeholder={$t('share.create.password_confirm_placeholder')}
              disabled={stage === 'creating'}
            />
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
        <Button onclick={handleCopy}>{$t('share.create.copy_link')}</Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
