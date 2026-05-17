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
  import NoteSnapshotView from '$lib/components/notes/NoteSnapshotView.svelte';
  import ShareGate from '$lib/components/notes/ShareGate.svelte';

  // Terminal "the link is gone" states: the recipient can't recover by
  // copy-pasting the URL again. These get the soft CTA ("Learn about re/notes")
  // because (a) they're trusted-referral touchpoints we don't want to leave
  // as dead ends and (b) there's no actionable fix to suggest, so a brand
  // pointer doesn't compete with a "do this instead" message. Recoverable
  // states (missing-key, decrypt-failed) and the transient `error` state are
  // intentionally CTA-free.
  const TERMINAL_STATES = new Set([
    'not-found',
    'expired',
    'revoked',
    'exhausted'
  ]);
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
    return (name.replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim() || 'note').slice(0, 100);
  }

  async function handleCopyMarkdown() {
    if (!notePayload) return;
    try {
      await navigator.clipboard.writeText(notePayload.content);
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
    if (!notePayload) return;
    const label =
      notePayload.display_name?.trim() ||
      notePayload.title?.trim() ||
      $t('share.view.untitled');
    const blob = new Blob([notePayload.content], { type: 'text/markdown; charset=utf-8' });
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
    // Opt out of the global iOS keyboard scroll-lock (app.css) - this is a
    // read-only public page, no contenteditable means no virtual keyboard,
    // and the page should scroll with the native browser scrollbar.
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

  function formatRelative(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(get(locale) ?? undefined);
    } catch {
      return iso;
    }
  }

  const notePayload = $derived(
    payload && payload.type === 'note' ? payload : null
  );
</script>

<svelte:head>
  <title>{$t('share.view.read_only_badge')} - reborn/notes</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background">
  <div class="mx-auto w-full max-w-4xl flex-1 px-4">
    <!-- Metadata-only header. No brand logo here on purpose: shared content
         belongs to the user, not to re/notes - prominent branding next to
         arbitrary user content would imply endorsement. Attribution lives in
         the footer instead (Bitwarden Send / Notion public pages pattern).

         All share metadata (title, sender, shared_at) lives here too, above
         the border, so the content area below holds ONLY the user's note.

         Header only renders once the snapshot is unlocked: pre-unlock there
         is no metadata to surface, and a lone READ-ONLY badge over an empty
         page looked unloved. The password gate (and other blocking states)
         carry their own self-contained centered layout below.

         Mobile layout: `flex-col-reverse` so chrome (READ-ONLY · EXPIRES)
         appears as a short status row on top, then the title block below
         with full viewport width. Without this, a long expiry timestamp
         starves the title to ~1ch and `break-words` shatters it char by
         char vertically. From `sm:` up, side-by-side as designed. -->
    {#if stage === 'ready' && notePayload}
    <header class="flex flex-col-reverse gap-y-1 border-b py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-4 sm:gap-y-2">
      <div class="min-w-0 sm:flex-1">
        {#if stage === 'ready' && notePayload}
          {@const headline = notePayload.display_name?.trim() || notePayload.title || $t('share.view.untitled')}
          <!-- No `font-semibold` here on purpose: the note's actual document
               title is the markdown H1 below the border, so this h1 is just
               an identifier label ("which share am I looking at?"). Same
               text-xs / muted-foreground as the meta row below so the whole
               header reads as one uniform meta block; the "Note:" prefix
               labels what the line is showing. The markdown H1 below the
               border owns the foreground weight. -->
          <h1 class="break-words text-xs leading-snug text-muted-foreground">
            {$t('share.view.note_label', { values: { label: headline } })}
          </h1>
          <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-snug text-muted-foreground">
            {#if notePayload.shared_by_label}
              <span>{$t('share.view.shared_by', { values: { label: notePayload.shared_by_label } })}</span>
              <span aria-hidden="true">·</span>
            {/if}
            <span>{$t('share.view.shared_at', { values: { relative: formatRelative(notePayload.shared_at) } })}</span>
          </div>
        {/if}
      </div>
      <!-- `leading-snug` here so wrapped chrome rows have predictable height
           that matches the meta/title leading - was the source of the uneven
           mobile rhythm (4px wrap-gap vs 8px block-gap vs 2px title-meta gap;
           now uniformly 4px). -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase leading-snug tracking-wider text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <ShieldCheck class="h-3.5 w-3.5" />
          {$t('share.view.read_only_badge')}
        </span>
        {#if stage === 'ready' && notePayload}
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
            <span>{$t('share.view.expires_in', { values: { relative: formatRelative(expiresAt) } })}</span>
          {/if}
        {/if}
      </div>
    </header>
    <!-- Recipient actions row. Ghost icon+label buttons sit right-aligned
         under the header so they read as tools belonging to the snapshot
         (clipboard / .md download) without competing with the content. The
         note itself is already plaintext in the viewer's browser - these
         shortcuts just save them from selecting/copying or screenshotting.
         Mobile keeps icons only (label hidden < sm) so the strip stays
         tight on narrow viewports. -->
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
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/notes' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'expired'}
      <ShareGate
        icon={Clock}
        title={$t('share.view.gate.title.expired')}
        hint={$t('share.view.gate.hint.expired')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/notes' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'revoked'}
      <ShareGate
        icon={Ban}
        title={$t('share.view.gate.title.revoked')}
        hint={$t('share.view.gate.hint.revoked')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/notes' } }),
          href: LEARN_MORE_URL
        }}
      />
    {:else if stage === 'exhausted'}
      <ShareGate
        icon={AlertOctagon}
        title={$t('share.view.gate.title.exhausted')}
        hint={$t('share.view.gate.hint.exhausted')}
        cta={{
          label: $t('share.view.gate.cta_learn_more', { values: { app: 're/notes' } }),
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
      <!-- Pre-unlock gate. Centered narrow column mirrors the in-app login
           page (small logo + intro + card) so the recipient immediately
           sees this is a re/notes share and not a phishing surface. Logo
           is intentionally one notch smaller than the login page (h-5 vs
           h-6) - the share is the user's content, not a login flow. -->
      <div class="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-4 sm:pt-12">
        <div class="flex flex-col items-center gap-3 text-center">
          <img src="{base}/logo-black.svg" alt="re/notes" class="block h-5 w-auto dark:hidden" />
          <img
            src="{base}/logo-white.svg"
            alt="re/notes"
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
    {:else if stage === 'ready' && notePayload}
      <NoteSnapshotView payload={notePayload} showHeader={false} />
    {/if}
    </main>
  </div>

  <!-- Footer attribution. Soft separator + small muted text so it sits at the
       page bottom without competing with the user's content. The reapps.eu
       link gives the recipient a path to learn what re/notes is (= organic
       growth) without claiming ownership of the shared content. -->
  <footer class="border-t border-border/60">
    <div class="mx-auto w-full max-w-4xl px-4 py-4 text-center text-xs text-muted-foreground">
      <span>{$t('share.view.footer_shared_from', { values: { app: 're/notes' } })}</span>
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
