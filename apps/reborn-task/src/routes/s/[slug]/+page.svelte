<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { Button, Input, Card } from '@reborn/ui';
  import {
    AlertCircle,
    AlertOctagon,
    Ban,
    Check,
    Clock,
    Copy,
    Download,
    Eye,
    EyeOff,
    KeyRound,
    Link2Off,
    Lock,
    ShieldAlert,
    ShieldCheck
  } from '@lucide/svelte';
  import { get } from 'svelte/store';
  import { t, locale } from '$lib/stores/i18n.store';
  import TaskSnapshotView from '$lib/components/tasks/TaskSnapshotView.svelte';
  import ShareGate from '$lib/components/share/ShareGate.svelte';
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

  // See notes-side share viewer for rationale: terminal "the link is gone"
  // states get the soft CTA, recoverable / transient states don't.
  const LEARN_MORE_URL = 'https://reapps.eu';

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
  let showPassword = $state(false);
  let passwordWrong = $state(false);
  let passwordSubmitting = $state(false);
  let payload = $state<SharedSnapshotPayload | null>(null);
  let expiresAt = $state<string | null>(null);
  let accessCount = $state<number | null>(null);
  let maxAccessCount = $state<number | null>(null);

  let slug = '';
  let fragmentKey = '';

  let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  function sanitizeFilename(name: string): string {
    return (name.replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim() || 'task').slice(0, 100);
  }

  // Tasks aren't authored in markdown - the snapshot is structured data
  // (title + metadata + subtasks + description). We synthesize a light
  // markdown representation that mirrors what the viewer sees: title as
  // H1, an optional meta line for due date / completed flag, then sections
  // for subtasks (as GFM task-list items) and free-form description. Same
  // labels as the rendered view so the .md file reads in the recipient's
  // locale.
  function buildTaskMarkdown(p: NonNullable<typeof taskPayload>): string {
    const headline =
      p.display_name?.trim() || p.title?.trim() || $t('share.view.untitled');
    const lines: string[] = [`# ${headline}`, ''];

    const meta: string[] = [];
    if (p.metadata.due_date) {
      meta.push(`${$t('share.view.task.due_date_label')}: ${formatDate(p.metadata.due_date)}`);
    }
    if (p.metadata.is_completed) {
      meta.push(`✓ ${$t('share.view.task.completed_badge')}`);
    }
    if (meta.length > 0) {
      lines.push(...meta, '');
    }

    if (p.subtasks.length > 0) {
      lines.push(`## ${$t('share.view.task.subtasks_label')}`, '');
      for (const subtask of p.subtasks) {
        const done = (subtask.metadata as { is_completed?: boolean } | undefined)?.is_completed;
        lines.push(`- [${done ? 'x' : ' '}] ${subtask.name}`);
      }
      lines.push('');
    }

    if (p.description) {
      lines.push(`## ${$t('share.view.task.description_label')}`, '', p.description, '');
    }

    return lines.join('\n').replace(/\n+$/, '\n');
  }

  async function handleCopyMarkdown() {
    if (!taskPayload) return;
    try {
      await navigator.clipboard.writeText(buildTaskMarkdown(taskPayload));
      copyStatus = 'copied';
    } catch {
      copyStatus = 'failed';
    }
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyStatus = 'idle';
      copyResetTimer = null;
    }, 2000);
  }

  function handleDownloadMarkdown() {
    if (!taskPayload) return;
    const label =
      taskPayload.display_name?.trim() ||
      taskPayload.title?.trim() ||
      $t('share.view.untitled');
    const blob = new Blob([buildTaskMarkdown(taskPayload)], {
      type: 'text/markdown; charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(label)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
      return new Date(iso).toLocaleString(get(locale) ?? undefined);
    } catch {
      return iso;
    }
  }

  const taskPayload = $derived(payload && payload.type === 'task' ? payload : null);
  // Only `due_date` and `is_completed` are surfaced in the public snapshot.
  // `is_starred` is intentionally NOT read here: starring is the owner's
  // personal organisational metadata ("this matters to me"), with no shared
  // semantic for the recipient, and surfacing it would subtly leak personal
  // state. The full payload field stays in the encrypted blob for owner-side
  // previews (TaskSnapshotView with showHeader=true), just not here.
  const taskMeta = $derived(taskPayload?.metadata as
    | { due_date?: string | null; is_completed?: boolean }
    | undefined);
</script>

<svelte:head>
  <title>{$t('share.view.read_only_badge')} - reborn/task</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background">
  <div class="mx-auto w-full max-w-3xl flex-1 px-4">
    <!-- Metadata-only header. Brand attribution lives in the footer instead -
         shared content is the user's, not re/task's, so we avoid letterhead
         framing. Mirrors the notes share viewer pattern.

         Differs from notes: the task title is NOT in this header - it lives
         below the border (see <main> below) as the document's h1. Rationale:
         tasks have no "content-supplied" title (no markdown H1), so the task
         title IS the document title and deserves the visual prominence the
         markdown H1 plays in notes. Mirrors the in-app task detail layout.
         Here we keep only share-level metadata: who shared, when, plus the
         read-only chrome on the right.

         Header only renders once the snapshot is unlocked: pre-unlock there
         is no metadata to surface, and a lone READ-ONLY badge over an empty
         page looked unloved. The password gate (and other blocking states)
         carry their own self-contained centered layout below. See notes
         share viewer for the matching pattern.

         Mobile layout: `flex-col-reverse` so chrome (READ-ONLY · EXPIRES)
         appears as a status row on top, then the share-meta row below. See
         notes share viewer for the squeeze bug this avoids. -->
    {#if stage === 'ready' && taskPayload}
    <header class="flex flex-col-reverse gap-y-1 border-b py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-4 sm:gap-y-2">
      <div class="min-w-0 sm:flex-1">
        {#if stage === 'ready' && taskPayload}
          <div class="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-snug text-muted-foreground">
            {#if taskPayload.shared_by_label}
              <span>{$t('share.view.shared_by', { values: { label: taskPayload.shared_by_label } })}</span>
              <span aria-hidden="true">·</span>
            {/if}
            <span>{$t('share.view.shared_at', { values: { relative: formatDate(taskPayload.shared_at) } })}</span>
          </div>
        {/if}
      </div>
      <!-- `leading-snug` here so wrapped chrome rows have predictable height
           that matches the meta leading - was the source of the uneven mobile
           rhythm (chrome wrap-gap 4px vs block-gap 8px). Now uniformly 4px. -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase leading-snug tracking-wider text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <ShieldCheck class="h-3.5 w-3.5" />
          {$t('share.view.read_only_badge')}
        </span>
        {#if stage === 'ready' && taskPayload}
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
        {/if}
      </div>
    </header>
    <!-- Recipient actions row. Mirrors the notes share viewer: ghost buttons
         dimmed to match the chrome row above. For a task there is no native
         markdown source, so the handlers synthesize a light .md (title +
         meta + subtasks as GFM task-list + description) before copy/save -
         see buildTaskMarkdown above. -->
    <div class="mt-2 flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onclick={handleCopyMarkdown}
        title={$t('share.view.actions.copy_markdown')}
        aria-label={$t('share.view.actions.copy_markdown')}
        class="text-xs font-normal text-muted-foreground hover:text-foreground"
      >
        {#if copyStatus === 'copied'}
          <Check class="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
          <span class="hidden sm:inline">{$t('share.view.actions.copy_done')}</span>
        {:else if copyStatus === 'failed'}
          <AlertCircle class="h-3.5 w-3.5 text-destructive" />
          <span class="hidden sm:inline">{$t('share.view.actions.copy_failed')}</span>
        {:else}
          <Copy class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{$t('share.view.actions.copy_markdown')}</span>
        {/if}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={handleDownloadMarkdown}
        title={$t('share.view.actions.download_markdown')}
        aria-label={$t('share.view.actions.download_markdown')}
        class="text-xs font-normal text-muted-foreground hover:text-foreground"
      >
        <Download class="h-3.5 w-3.5" />
        <span class="hidden sm:inline">{$t('share.view.actions.download_markdown')}</span>
      </Button>
    </div>
    {/if}

    <main class="flex flex-col gap-6 pb-10 pt-10">
      {#if stage === 'loading'}
      <p class="text-sm text-muted-foreground">{$t('share.view.loading')}</p>
    {:else if stage === 'missing-key'}
      <ShareGate
        icon={KeyRound}
        title={$t('share.view.gate.title.missing_key')}
        hint={$t('share.view.gate.hint.missing_key')}
      />
    {:else if stage === 'not-found'}
      <ShareGate
        icon={Link2Off}
        title={$t('share.view.gate.title.not_found')}
        hint={$t('share.view.gate.hint.not_found')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/task' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'expired'}
      <ShareGate
        icon={Clock}
        title={$t('share.view.gate.title.expired')}
        hint={$t('share.view.gate.hint.expired')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/task' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'revoked'}
      <ShareGate
        icon={Ban}
        title={$t('share.view.gate.title.revoked')}
        hint={$t('share.view.gate.hint.revoked')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/task' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'exhausted'}
      <ShareGate
        icon={AlertOctagon}
        title={$t('share.view.gate.title.exhausted')}
        hint={$t('share.view.gate.hint.exhausted')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/task' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'decrypt-failed'}
      <ShareGate
        icon={ShieldAlert}
        title={$t('share.view.gate.title.decrypt_failed')}
        hint={$t('share.view.gate.hint.decrypt_failed')}
      />
    {:else if stage === 'error'}
      <ShareGate
        icon={AlertCircle}
        title={$t('share.view.gate.title.error')}
        hint={errorDetail || $t('share.view.gate.hint.error')}
      />
    {:else if stage === 'password-prompt'}
      <!-- Pre-unlock gate. Mirrors the notes share viewer pattern: centered
           narrow column with a small re/task logo + intro + card so the
           recipient sees this is a re/task share rather than a phishing
           page. Logo at h-5 (one notch smaller than the in-app login). -->
      <div class="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-4 sm:pt-12">
        <div class="flex flex-col items-center gap-3 text-center">
          <img src="{base}/logo-black.svg" alt="re/task" class="block h-5 w-auto dark:hidden" />
          <img
            src="{base}/logo-white.svg"
            alt="re/task"
            class="hidden h-5 w-auto dark:block dark:opacity-80"
          />
          <p class="text-sm text-muted-foreground">
            {$t('share.view.password_intro')}
          </p>
        </div>
        <Card class="flex w-full flex-col gap-4 p-6">
          <div class="flex items-center gap-2">
            <Lock class="h-5 w-5 text-muted-foreground" />
            <h1 class="text-base font-semibold">{$t('share.view.password_prompt')}</h1>
          </div>
          <form
            class="flex flex-col gap-3"
            onsubmit={(e) => {
              e.preventDefault();
              void handlePasswordSubmit();
            }}
          >
            <div class="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                placeholder={$t('share.create.password_placeholder')}
                autocomplete="off"
                disabled={passwordSubmitting}
                class="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onclick={() => (showPassword = !showPassword)}
                tabindex={-1}
              >
                {#if showPassword}
                  <EyeOff class="h-4 w-4 text-muted-foreground" />
                {:else}
                  <Eye class="h-4 w-4 text-muted-foreground" />
                {/if}
              </Button>
            </div>
            {#if passwordWrong}
              <p class="text-sm text-destructive">{$t('share.view.password_wrong')}</p>
            {/if}
            <Button type="submit" disabled={passwordSubmitting || password.length === 0}>
              {$t('share.view.password_submit')}
            </Button>
          </form>
        </Card>
      </div>
    {:else if stage === 'ready' && taskPayload}
      <!-- Task title lives in the content area (not the header) because the
           task title IS the document title - tasks have no markdown body to
           supply one. Semantic h1 (one per page, a11y/SEO), visual text-xl
           (lighter than the default 2rem h1; the snapshot is meant to read
           like a document, not a heading-only landing page). -->
      {@const headline = taskPayload.display_name?.trim() || taskPayload.title || $t('share.view.untitled')}
      <header class="flex flex-col gap-1">
        <h1
          class="break-words text-xl font-semibold leading-tight text-foreground"
          class:line-through={taskMeta?.is_completed}
        >
          {headline}
        </h1>
        {#if taskMeta?.due_date || taskMeta?.is_completed}
          <div class="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {#if taskMeta?.due_date}
              <span>{$t('share.view.task.due_date_label')}: {formatDate(taskMeta.due_date)}</span>
            {/if}
            {#if taskMeta?.due_date && taskMeta?.is_completed}
              <span aria-hidden="true">·</span>
            {/if}
            {#if taskMeta?.is_completed}
              <span>{$t('share.view.task.completed_badge')}</span>
            {/if}
          </div>
        {/if}
      </header>
      <TaskSnapshotView payload={taskPayload} showHeader={false} />
    {/if}
    </main>
  </div>

  <!-- Footer attribution. See notes share viewer for design rationale. -->
  <footer class="border-t border-border/60">
    <div class="mx-auto w-full max-w-3xl px-4 py-4 text-center text-xs text-muted-foreground">
      <span>{$t('share.view.footer_shared_from', { values: { app: 're/task' } })}</span>
      <span aria-hidden="true"> · </span>
      <span>{$t('share.view.footer_e2e_encrypted')}</span>
      <span aria-hidden="true"> · </span>
      <a
        href="https://reapps.eu"
        target="_blank"
        rel="noopener noreferrer"
        class="underline-offset-2 hover:underline"
      >
        reapps.eu
      </a>
    </div>
  </footer>
</div>
