<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { Button, Input, Card } from '@reborn/ui';
  import { Lock, ShieldCheck } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';
  import TaskSnapshotView from '$lib/components/tasks/TaskSnapshotView.svelte';
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
    // Mirror notes share view: tag <html>/<body> so any current/future global
    // body scroll-lock (e.g. mobile keyboard workaround) can opt this public
    // read-only page out. Harmless if no such rule exists yet.
    document.documentElement.classList.add('share-view');
    document.body.classList.add('share-view');

    slug = $page.params.slug ?? '';
    const fragment = parseShareFragment(window.location.hash);
    if (fragment) {
      fragmentKey = fragment.key;
      void attempt(true);
    } else {
      stage = 'missing-key';
    }

    return () => {
      document.documentElement.classList.remove('share-view');
      document.body.classList.remove('share-view');
    };
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
</script>

<svelte:head>
  <title>{$t('share.view.read_only_badge')} - reborn/task</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="min-h-screen bg-background">
  <div class="h-[3px] w-full bg-green-500" aria-hidden="true"></div>
  <div class="mx-auto max-w-3xl px-4">
    <header class="flex h-14 items-center justify-between gap-3 border-b">
      <a
        href="https://reapps.eu"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center transition-opacity hover:opacity-80"
        aria-label="re/task"
      >
        <img src="{base}/logo-black.svg" alt="re/task" class="block h-4 w-auto dark:hidden" />
        <img src="{base}/logo-white.svg" alt="re/task" class="hidden h-4 w-auto dark:block dark:opacity-80" />
      </a>

      {#if stage === 'ready' && taskPayload}
        <div class="hidden flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground sm:flex">
          <span class="inline-flex items-center gap-1">
            <ShieldCheck class="h-3.5 w-3.5" />
            {$t('share.view.read_only_badge')}
          </span>
          {#if maxAccessCount !== null && accessCount !== null}
            <span aria-hidden="true">·</span>
            <span>
              {$t('share.view.opens_progress', {
                values: { used: accessCount, max: maxAccessCount }
              })}
            </span>
          {/if}
          {#if expiresAt}
            <span aria-hidden="true">·</span>
            <span>{$t('share.view.expires_in', { values: { relative: formatDate(expiresAt) } })}</span>
          {/if}
        </div>
      {/if}
    </header>

    <main class="flex flex-col gap-4 py-6">
      {#if stage === 'ready' && taskPayload}
        <div class="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground sm:hidden">
          <span class="inline-flex items-center gap-1">
            <ShieldCheck class="h-3.5 w-3.5" />
            {$t('share.view.read_only_badge')}
          </span>
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
      {/if}
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
      <TaskSnapshotView payload={taskPayload} />
    {/if}
    </main>
  </div>
</div>
