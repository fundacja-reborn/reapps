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
      // Defense-in-depth: snapshot ships only the metadata fields the public
      // viewer actually renders (due_date / has_time for the date display,
      // is_completed for line-through + badge). Dropped on purpose:
      //   - is_starred         personal "favourites" marker, no shared meaning
      //   - reminder_date      personal reminder, recipient has no use for it
      //   - completed_at       exact completion timestamp leaks productivity patterns
      //   - is_recurring + next_occurrence_date + recurrence_base_date +
      //     completed_occurrences_count   snapshot is a frozen point in time;
      //                                   recurrence schedule is meaningless here
      //   - notification_sent  app-internal state, never user-facing
      // See SharedSnapshotTaskMetadata doc comment for the wider rationale.
      const payload: SharedSnapshotTaskPayload = {
        type: 'task',
        v: SNAPSHOT_PAYLOAD_VERSION,
        title: task.title ?? '',
        description: task.description || undefined,
        metadata: {
          due_date: task.due_date ?? null,
          has_time: task.has_time,
          is_completed: task.is_completed
        },
        subtasks: subtasks.map((s) => ({
          name: s.title,
          metadata: { is_completed: s.is_completed }
        })),
        shared_at: new Date().toISOString(),
        shared_by_label: senderLabel.trim() || undefined,
        display_name: displayName.trim() || undefined,
        source_id: task.id
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
          <Label for="share-task-display-name">{$t('share.create.display_name_label')}</Label>
          <Input
            id="share-task-display-name"
            bind:value={displayName}
            placeholder={task?.title || $t('share.create.display_name_placeholder')}
            maxlength={SHARE_DISPLAY_NAME_MAX_LENGTH}
            disabled={stage === 'creating'}
          />
          <p class="text-xs text-muted-foreground">{$t('share.create.display_name_hint')}</p>
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
