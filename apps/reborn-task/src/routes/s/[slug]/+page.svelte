<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { Button, Input, Card } from '@reborn/ui';
  import { Lock, ShieldCheck, Star, CheckCircle2, Circle } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import {
    importKeyFromBase64url,
    decryptSnapshotPayload,
    parseShareFragment
  } from '@reborn/crypto';
  import {
    SharedSnapshotPayloadSchema,
    type SharedSnapshotPayload,
    type SharePublicResponse
  } from '@reborn/types';

  type Stage =
    | 'loading'
    | 'missing-key'
    | 'not-found'
    | 'expired'
    | 'revoked'
    | 'exhausted'
    | 'decrypt-failed'
    | 'password-prompt'
    | 'ready'
    | 'error';

  let stage = $state<Stage>('loading');
  let errorDetail = $state('');
  let password = $state('');
  let passwordWrong = $state(false);
  let passwordSubmitting = $state(false);
  let payload = $state<SharedSnapshotPayload | null>(null);
  let expiresAt = $state<string | null>(null);
  let accessCount = $state<number | null>(null);
  let maxAccessCount = $state<number | null>(null);

  let slug = '';
  let fragmentKey = '';

  function classifyGoneCode(code: string | undefined): Stage {
    if (code === 'EXHAUSTED') return 'exhausted';
    if (code === 'REVOKED') return 'revoked';
    return 'expired';
  }

  async function fetchSnapshot(passwordValue?: string) {
    const headers: Record<string, string> = {};
    if (passwordValue) headers['X-Share-Password'] = passwordValue;
    return fetch(`${base}/api/shares/${slug}`, {
      method: 'GET',
      credentials: 'omit',
      headers
    });
  }

  async function decryptAndShow(ciphertext: string) {
    try {
      const key = await importKeyFromBase64url(fragmentKey);
      const decrypted = await decryptSnapshotPayload(ciphertext, key);
      const parsed = SharedSnapshotPayloadSchema.safeParse(decrypted);
      if (!parsed.success) {
        stage = 'decrypt-failed';
        return;
      }
      payload = parsed.data;
      stage = 'ready';
    } catch {
      stage = 'decrypt-failed';
    }
  }

  async function attempt(initial: boolean, passwordValue?: string) {
    try {
      const res = await fetchSnapshot(passwordValue);
      if (res.status === 401 && !initial) {
        passwordWrong = true;
        passwordSubmitting = false;
        return;
      }
      if (!res.ok) {
        if (res.status === 404) {
          stage = 'not-found';
          return;
        }
        if (res.status === 410) {
          const body = await res.json().catch(() => ({}));
          stage = classifyGoneCode(body?.code);
          return;
        }
        stage = 'error';
        return;
      }
      const json = (await res.json()) as { success: boolean; data: SharePublicResponse };
      const data = json.data;
      if (data.password_required) {
        stage = 'password-prompt';
        return;
      }
      expiresAt = data.expires_at;
      accessCount = data.access_count;
      maxAccessCount = data.max_access_count;
      await decryptAndShow(data.payload_encrypted);
    } catch (err: unknown) {
      stage = 'error';
      errorDetail = err instanceof Error ? err.message : String(err);
    }
  }

  async function handlePasswordSubmit() {
    if (passwordSubmitting) return;
    passwordSubmitting = true;
    passwordWrong = false;
    await attempt(false, password);
    if (stage === 'password-prompt' || passwordWrong) {
      passwordSubmitting = false;
    }
  }

  onMount(() => {
    slug = $page.params.slug ?? '';
    const fragment = parseShareFragment(window.location.hash);
    if (!fragment) {
      stage = 'missing-key';
      return;
    }
    fragmentKey = fragment.key;
    void attempt(true);
  });

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  const taskPayload = $derived(payload && payload.type === 'task' ? payload : null);
  const taskMeta = $derived(taskPayload?.metadata as { due_date?: string | null; has_time?: boolean; is_completed?: boolean; is_starred?: boolean } | undefined);
</script>

<svelte:head>
  <title>{$t('share.view.read_only_badge')} - reborn/task</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="min-h-screen bg-background">
  <main class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
    {#if stage === 'loading'}
      <p class="text-sm text-muted-foreground">{$t('share.view.loading')}</p>
    {:else if stage === 'missing-key'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{$t('share.view.missing_key')}</p>
      </Card>
    {:else if stage === 'not-found'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{$t('share.view.not_found')}</p>
      </Card>
    {:else if stage === 'expired'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{$t('share.view.expired')}</p>
      </Card>
    {:else if stage === 'revoked'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{$t('share.view.not_found')}</p>
      </Card>
    {:else if stage === 'exhausted'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{$t('share.view.exhausted')}</p>
      </Card>
    {:else if stage === 'decrypt-failed'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{$t('share.view.decrypt_failed')}</p>
      </Card>
    {:else if stage === 'error'}
      <Card class="p-6">
        <h1 class="text-lg font-semibold">{$t('share.view.error_title')}</h1>
        <p class="mt-2 text-sm text-muted-foreground">{errorDetail}</p>
      </Card>
    {:else if stage === 'password-prompt'}
      <Card class="flex flex-col gap-4 p-6">
        <div class="flex items-center gap-2">
          <Lock class="h-5 w-5 text-muted-foreground" />
          <h1 class="text-lg font-semibold">{$t('share.view.password_prompt')}</h1>
        </div>
        <form
          class="flex flex-col gap-3"
          onsubmit={(e) => {
            e.preventDefault();
            void handlePasswordSubmit();
          }}
        >
          <Input
            type="password"
            bind:value={password}
            placeholder={$t('share.create.password_placeholder')}
            autocomplete="off"
            disabled={passwordSubmitting}
          />
          {#if passwordWrong}
            <p class="text-sm text-destructive">{$t('share.view.password_wrong')}</p>
          {/if}
          <Button type="submit" disabled={passwordSubmitting || password.length === 0}>
            {$t('share.view.password_submit')}
          </Button>
        </form>
      </Card>
    {:else if stage === 'ready' && taskPayload}
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <ShieldCheck class="h-3.5 w-3.5" />
          {$t('share.view.read_only_badge')}
        </span>
        <div class="flex flex-wrap items-center gap-3">
          {#if maxAccessCount !== null && accessCount !== null}
            <span>
              {$t('share.view.opens_progress', {
                values: { used: accessCount, max: maxAccessCount }
              })}
            </span>
          {/if}
          {#if expiresAt}
            <span>{$t('share.view.expires_in', { values: { relative: formatDate(expiresAt) } })}</span>
          {/if}
        </div>
      </div>

      <div class="flex items-start gap-3">
        {#if taskMeta?.is_completed}
          <CheckCircle2 class="mt-1 h-5 w-5 shrink-0 text-green-600" />
        {:else}
          <Circle class="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        {/if}
        <h1 class="flex-1 text-2xl font-semibold leading-tight" class:line-through={taskMeta?.is_completed}>
          {taskPayload.title || $t('share.view.untitled')}
        </h1>
        {#if taskMeta?.is_starred}
          <Star class="mt-1 h-5 w-5 shrink-0 fill-yellow-400 text-yellow-400" />
        {/if}
      </div>

      <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {#if taskPayload.shared_by_label}
          <span>{$t('share.view.shared_by', { values: { label: taskPayload.shared_by_label } })}</span>
        {/if}
        <span>{$t('share.view.shared_at', { values: { relative: formatDate(taskPayload.shared_at) } })}</span>
        {#if taskMeta?.due_date}
          <span>· {$t('share.view.task.due_date_label')}: {formatDate(taskMeta.due_date)}</span>
        {/if}
        {#if taskMeta?.is_completed}
          <span>· {$t('share.view.task.completed_badge')}</span>
        {/if}
      </div>

      {#if taskPayload.description}
        <Card class="p-4">
          <p class="whitespace-pre-wrap text-sm">{taskPayload.description}</p>
        </Card>
      {:else}
        <p class="text-xs italic text-muted-foreground">{$t('share.view.task.no_description')}</p>
      {/if}

      <section class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {$t('share.view.task.subtasks_label')}
        </h2>
        {#if taskPayload.subtasks.length === 0}
          <p class="text-xs italic text-muted-foreground">{$t('share.view.task.no_subtasks')}</p>
        {:else}
          <ul class="flex flex-col gap-1">
            {#each taskPayload.subtasks as subtask, i (i)}
              {@const completed = (subtask.metadata as { is_completed?: boolean } | undefined)?.is_completed}
              <li class="flex items-start gap-2 text-sm">
                <input type="checkbox" disabled checked={completed} class="mt-0.5" />
                <span class:line-through={completed} class:text-muted-foreground={completed}>
                  {subtask.name}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <footer class="mt-8 border-t pt-4 text-center text-xs text-muted-foreground">
        <a href="https://reapps.eu" rel="noopener noreferrer" class="hover:underline">
          {$t('share.view.powered_by')}
        </a>
      </footer>
    {/if}
  </main>
</div>
