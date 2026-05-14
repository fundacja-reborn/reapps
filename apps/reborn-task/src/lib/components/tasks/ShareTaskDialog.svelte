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
  import {
    cryptoManager,
    generateSnapshotKey,
    exportKeyToBase64url,
    encryptSnapshotPayload,
    buildShareUrl
  } from '@reborn/crypto';
  import {
    SHARE_EXPIRY_PRESETS,
    SHARE_MAX_ACCESS_COUNT_LIMIT,
    SNAPSHOT_PAYLOAD_VERSION,
    SHARE_SENDER_LABEL_MAX_LENGTH,
    type CreateShareResponse,
    type SharedSnapshotTaskPayload
  } from '@reborn/types';
  import type { TaskDecrypted, Subtask } from '@reborn/types';
  import { getSubtasksForTask } from '$lib/stores/decrypted-subtasks.store';

  type ExpiryPreset = keyof typeof SHARE_EXPIRY_PRESETS;
  type Stage = 'form' | 'creating' | 'success' | 'error';

  let {
    open = $bindable(false),
    task
  }: {
    open: boolean;
    task: TaskDecrypted | null;
  } = $props();

  let stage = $state<Stage>('form');
  let expiry = $state<ExpiryPreset>('7d');
  let senderLabel = $state('');
  let passwordEnabled = $state(false);
  let password = $state('');
  let passwordConfirm = $state('');
  let maxOpensUnlimited = $state(true);
  let maxOpens = $state(5);
  let errorMessage = $state('');
  let resultUrl = $state('');

  function resetForm() {
    stage = 'form';
    expiry = '7d';
    senderLabel = '';
    passwordEnabled = false;
    password = '';
    passwordConfirm = '';
    maxOpensUnlimited = true;
    maxOpens = 5;
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
      if (!Number.isInteger(maxOpens) || maxOpens < 1 || maxOpens > SHARE_MAX_ACCESS_COUNT_LIMIT) {
        return $t('share.create.max_opens_invalid');
      }
    }
    return null;
  }

  async function handleCreate() {
    if (!task) {
      errorMessage = 'No task';
      stage = 'error';
      return;
    }
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
      const subtasks: Subtask[] = getSubtasksForTask(task.id);
      const payload: SharedSnapshotTaskPayload = {
        type: 'task',
        v: SNAPSHOT_PAYLOAD_VERSION,
        title: task.title ?? '',
        description: task.description || undefined,
        metadata: {
          due_date: task.due_date ?? null,
          has_time: task.has_time,
          is_completed: task.is_completed,
          is_starred: task.is_starred,
          is_recurring: task.is_recurring,
          completed_at: task.completed_at ?? null,
          reminder_date: task.reminder_date ?? null,
          next_occurrence_date: task.next_occurrence_date ?? null,
          recurrence_base_date: task.recurrence_base_date ?? null,
          completed_occurrences_count: task.completed_occurrences_count,
          notification_sent: task.notification_sent
        },
        subtasks: subtasks.map((s) => ({
          name: s.title,
          metadata: { is_completed: s.is_completed }
        })),
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
          password: passwordEnabled ? password : undefined,
          max_access_count: maxOpensUnlimited ? null : maxOpens
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

  const subtasksCount = $derived(task ? getSubtasksForTask(task.id).length : 0);
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$t('share.task.dialog_header')}</DialogTitle>
      {#if task}
        <DialogDescription>
          {task.title}
          {#if subtasksCount > 0}
            · {$t('share.task.subtasks_count', { values: { count: subtasksCount } })}
          {/if}
        </DialogDescription>
      {/if}
    </DialogHeader>

    {#if stage === 'form' || stage === 'creating' || stage === 'error'}
      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-2">
          <Label for="share-task-expiry">{$t('share.create.expires_label')}</Label>
          <select
            id="share-task-expiry"
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
          <Label for="share-task-max-opens">{$t('share.create.max_opens_label')}</Label>
          <div class="flex items-center gap-2">
            <Input
              id="share-task-max-opens"
              type="number"
              min="1"
              max={SHARE_MAX_ACCESS_COUNT_LIMIT}
              step="1"
              bind:value={maxOpens}
              placeholder={$t('share.create.max_opens_placeholder')}
              disabled={stage === 'creating' || maxOpensUnlimited}
              class="flex-1"
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
          <Label for="share-task-sender">{$t('share.create.sender_label')}</Label>
          <Input
            id="share-task-sender"
            bind:value={senderLabel}
            placeholder={$t('share.create.sender_label_placeholder')}
            maxlength={SHARE_SENDER_LABEL_MAX_LENGTH}
            disabled={stage === 'creating'}
          />
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={passwordEnabled} disabled={stage === 'creating'} />
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
        <Button onclick={handleCreate} disabled={stage === 'creating' || !task}>
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
