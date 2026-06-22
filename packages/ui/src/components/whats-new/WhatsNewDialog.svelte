<script lang="ts">
  import { ExternalLink } from '@lucide/svelte';
  import {
    t,
    locale,
    getReleaseNotes,
    formatDate,
    type LocalizedRelease,
    type ReleaseApp,
    type ReleaseCategory,
    type ReleasePlatform,
    type SupportedLocale
  } from '@reborn/i18n';
  import { Dialog, DialogContent, DialogTitle } from '../dialog';
  import { Button } from '../button';

  let {
    open = $bindable(false),
    app,
    platform,
    fullChangelogHref
  }: {
    open?: boolean;
    /** Which app this build is - filters the history to relevant items. */
    app: ReleaseApp;
    /** Current platform - hides items that don't apply (e.g. native-only on web). */
    platform: ReleasePlatform;
    /** Optional "Full changelog" link (e.g. the website /changelog page). */
    fullChangelogHref?: string;
  } = $props();

  // How many releases to show before the "Show older updates" affordance.
  const INITIAL_COUNT = 8;
  const CATEGORY_ORDER: ReleaseCategory[] = ['new', 'improved', 'fixed'];

  let releases = $state<LocalizedRelease[]>([]);
  let loading = $state(false);
  let showAll = $state(false);
  // Guard so the async load runs once per (app, platform, locale), not on every tick.
  let loadedKey = $state('');
  let wasOpen = false;

  $effect(() => {
    // Reset the "show older" toggle each time the dialog is (re)opened.
    if (open && !wasOpen) showAll = false;
    wasOpen = open;
  });

  $effect(() => {
    if (!open) return;
    const loc = ($locale ?? 'en') as SupportedLocale;
    const key = `${app}:${platform}:${loc}`;
    if (key === loadedKey) return;
    loading = true;
    getReleaseNotes({ app, platform, locale: loc })
      .then((r) => {
        releases = r;
        loadedKey = key;
      })
      .catch(() => {
        releases = [];
      })
      .finally(() => {
        loading = false;
      });
  });

  let visible = $derived(showAll ? releases : releases.slice(0, INITIAL_COUNT));
  let hasMore = $derived(!showAll && releases.length > INITIAL_COUNT);

  function groups(items: LocalizedRelease['items']) {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: items.filter((i) => i.category === category)
    })).filter((g) => g.items.length > 0);
  }

  function fmtDate(date: string): string {
    return formatDate(date, ($locale ?? 'en') as string, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
</script>

<Dialog bind:open>
  <DialogContent class="flex flex-col gap-0 overflow-y-hidden p-0 sm:max-w-[560px]">
    <!-- Sticky header: stays pinned while the body scrolls underneath. -->
    <header class="shrink-0 border-b px-6 py-4 pr-12">
      <DialogTitle class="text-xl font-semibold tracking-tight">
        {$t('whats_new.title')}
      </DialogTitle>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {#if loading && releases.length === 0}
        <p class="py-6 text-center text-sm text-muted-foreground">{$t('common.loading')}</p>
      {:else if releases.length === 0}
        <p class="py-6 text-center text-sm text-muted-foreground">{$t('whats_new.empty')}</p>
      {:else}
        <div class="divide-y divide-border">
          {#each visible as release (release.version)}
            <section class="space-y-3 py-5 first:pt-0 last:pb-0">
              <div class="flex items-baseline justify-between gap-3">
                <h3 class="text-base font-semibold">{fmtDate(release.date)}</h3>
                <span
                  class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  v{release.version}
                </span>
              </div>

              {#each groups(release.items) as group (group.category)}
                <div class="space-y-1.5">
                  <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {$t(`whats_new.category_${group.category}`)}
                  </p>
                  <ul class="space-y-2">
                    {#each group.items as item (item.id)}
                      <li class="flex gap-2.5">
                        <span
                          aria-hidden="true"
                          class="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                        ></span>
                        <p class="text-sm leading-relaxed text-foreground">{item.text}</p>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </section>
          {/each}
        </div>
      {/if}
    </div>

    {#if hasMore || fullChangelogHref}
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-6 py-3">
        {#if hasMore}
          <Button variant="ghost" size="sm" onclick={() => (showAll = true)}>
            {$t('whats_new.show_older')}
          </Button>
        {:else}
          <span></span>
        {/if}
        {#if fullChangelogHref}
          <a
            href={fullChangelogHref}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {$t('whats_new.full_changelog')}
            <ExternalLink class="h-3.5 w-3.5" />
          </a>
        {/if}
      </div>
    {/if}
  </DialogContent>
</Dialog>
