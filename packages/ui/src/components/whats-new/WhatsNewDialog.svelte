<script lang="ts">
  import { ExternalLink, Sparkles } from '@lucide/svelte';
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
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../dialog';
  import { Button } from '../button';
  import { cn } from '../../utils/cn';

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
  const CATEGORY_CLASS: Record<ReleaseCategory, string> = {
    new: 'text-emerald-600 dark:text-emerald-400',
    improved: 'text-blue-600 dark:text-blue-400',
    fixed: 'text-amber-600 dark:text-amber-400'
  };

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
  <DialogContent class="sm:max-w-[560px]">
    <DialogHeader>
      <DialogTitle class="flex items-center gap-2">
        <Sparkles class="h-5 w-5 text-primary" />
        {$t('whats_new.title')}
      </DialogTitle>
    </DialogHeader>

    {#if loading && releases.length === 0}
      <p class="py-6 text-center text-sm text-muted-foreground">{$t('common.loading')}</p>
    {:else if releases.length === 0}
      <p class="py-6 text-center text-sm text-muted-foreground">{$t('whats_new.empty')}</p>
    {:else}
      <div class="space-y-6">
        {#each visible as release (release.version)}
          <section class="space-y-3">
            <div class="flex items-baseline justify-between gap-3 border-b pb-1.5">
              <h3 class="text-sm font-semibold">{fmtDate(release.date)}</h3>
              <span
                class="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              >
                v{release.version}
              </span>
            </div>

            {#each groups(release.items) as group (group.category)}
              <div class="space-y-1.5">
                <p
                  class={cn(
                    'text-xs font-semibold uppercase tracking-wide',
                    CATEGORY_CLASS[group.category]
                  )}
                >
                  {$t(`whats_new.category_${group.category}`)}
                </p>
                <ul class="space-y-1.5">
                  {#each group.items as item (item.id)}
                    <li class="flex gap-2">
                      <span aria-hidden="true" class="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60"></span>
                      <div class="min-w-0">
                        <span class="text-sm font-medium text-foreground">{item.title}</span>
                        {#if item.description}
                          <p class="text-sm text-muted-foreground">{item.description}</p>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </section>
        {/each}
      </div>

      {#if hasMore || fullChangelogHref}
        <div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
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
    {/if}
  </DialogContent>
</Dialog>
