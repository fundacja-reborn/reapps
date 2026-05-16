<script lang="ts">
  import { resolve } from '$app/paths';
  import {
    Palette,
    Info,
    CheckSquare,
    FileDown,
    LogOut,
    Lock,
    ShieldCheck,
    Shield,
    Trash2,
    LayoutList,
    Share2,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ExternalLink,
    Globe,
    CircleHelp,
    FileText,
    Scale,
    User,
    HardDrive,
    ShieldAlert,
    CalendarDays
  } from '@lucide/svelte';
  import { goto } from '$lib/utils/navigation';
  import { t } from '$lib/stores/i18n.store';
  import { locale } from '$lib/stores/i18n.store';
  import { cn, GithubMark } from '@reborn/ui';
  import { authStore } from '$lib/stores/auth.store';
  import { onMount } from 'svelte';
  import {
    quotaUsedBytes,
    quotaLimitBytes,
    quotaPercent,
    quotaLoading,
    quotaNotesBytes,
    quotaVersionsBytes,
    quotaSharesBytes,
    isOverQuota,
    isQuotaWarning,
    refreshQuota
  } from '$lib/stores/storage-quota.store';

  // Bypass SvelteKit typed routes for dynamic string hrefs
  const resolveHref = resolve as unknown as (path: string) => string;

  let storageInfoExpanded = $state(false);

  onMount(() => {
    if ($authStore.isAuthenticated) {
      void refreshQuota();
    }
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const siteUrl: string =
    (import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? 'https://reapps.eu';

  const taskUrl: string =
    (import.meta.env.PUBLIC_TASK_URL as string | undefined) ?? 'https://reapps.eu/task';

  function buildSiteUrl(path: string): string {
    const prefix = $locale !== 'en' ? '/' + $locale : '';
    return `${siteUrl}${prefix}${path}`;
  }

  function handleLogout() {
    authStore.logout();
  }

  const itemClasses = cn(
    'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 rounded-lg'
  );

  const securityItems = [
    {
      icon: Lock,
      title: $t('settings_page.security.change_password'),
      description: $t('settings_page.security.change_password_desc'),
      href: '/settings/security/password'
    },
    {
      icon: ShieldCheck,
      title: $t('settings_page.security.recovery_codes'),
      description: $t('settings_page.security.recovery_codes_desc'),
      href: '/settings/security/recovery-codes'
    },
    {
      icon: Shield,
      title: $t('settings_page.security.two_factor'),
      description: $t('settings_page.security.two_factor_desc'),
      href: '/settings/security/two-factor'
    },
    {
      icon: LayoutList,
      title: $t('settings_page.security.active_sessions'),
      description: $t('settings_page.security.active_sessions_desc'),
      href: '/settings/security/sessions'
    },
    {
      icon: Share2,
      title: $t('share.list.settings_title'),
      description: $t('share.list.settings_desc'),
      href: '/settings/security/shares'
    }
  ];
</script>

<svelte:head>
  <title>{$t('settings_page.title')} — re/notes</title>
</svelte:head>

<div class="h-dvh overflow-y-auto bg-background">
  <div class="sticky top-0 z-10 bg-background border-b">
    <div class="container mx-auto max-w-4xl px-4 sm:px-6">
      <div class="flex items-center gap-2 h-14">
        <button
          type="button"
          onclick={() => goto('/')}
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground h-9 w-9 -ml-2"
        >
          <ChevronLeft class="h-5 w-5" />
          <span class="sr-only">{$t('common.back')}</span>
        </button>
        <h1 class="text-lg font-semibold">{$t('settings_page.title')}</h1>
      </div>
    </div>
  </div>

  <div class="container mx-auto max-w-4xl py-6 px-4 sm:px-6">
    <p class="text-sm text-muted-foreground mb-8">{$t('settings_page.about.desc')}</p>

    <div class="space-y-8">
      <!-- Account -->
      <div class="space-y-1">
        <h2 class="text-lg font-semibold mb-3">{$t('settings_page.account.title')}</h2>
        <div class="space-y-1">
          <div class={itemClasses}>
            <User class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$authStore.username}</div>
              <div class="text-sm text-muted-foreground">
                {#if $authStore.createdAt}
                  {$t('settings_page.account.member_since')}
                  {new Date($authStore.createdAt).toLocaleDateString(
                    $locale ?? undefined,
                    { year: 'numeric', month: 'long', day: 'numeric' }
                  )}
                {/if}
              </div>
            </div>
          </div>
          <button
            type="button"
            onclick={handleLogout}
            class={cn(itemClasses, 'w-full text-destructive hover:bg-destructive/5')}
          >
            <LogOut class="h-5 w-5 shrink-0" />
            <div class="flex-1 min-w-0 text-left">
              <div class="font-medium">{$t('settings_page.account.log_out')}</div>
            </div>
          </button>
        </div>
      </div>
      <!-- Preferences -->
      <div class="space-y-1">
        <h2 class="text-lg font-semibold mb-3">{$t('settings_page.preferences')}</h2>
        <div class="space-y-1">
          <a href={resolve('/settings/appearance')} class={itemClasses}>
            <Palette class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.appearance.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.appearance.hub_desc')}
              </div>
            </div>
            <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
          </a>
          <a href={resolve('/settings/periodic-notes')} class={itemClasses}>
            <CalendarDays class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('notes.periodic.settings.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('notes.periodic.settings.description')}
              </div>
            </div>
            <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
          </a>
        </div>
      </div>

      <!-- Security -->
      {#if $authStore.isAuthenticated}
        <div class="space-y-1">
          <h2 class="text-lg font-semibold mb-3">{$t('settings_page.security.title')}</h2>
          <div class="space-y-1">
            {#each securityItems as item}
            <a href={resolveHref(item.href)} class={itemClasses}>
                <item.icon class="h-5 w-5 text-muted-foreground shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="font-medium">{item.title}</div>
                  <div class="text-sm text-muted-foreground">{item.description}</div>
                </div>
                <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
              </a>
            {/each}

            <!-- Delete account -->
            <a
              href={resolve('/settings/security/delete-account')}
              class={cn(itemClasses, 'text-destructive hover:bg-destructive/5')}
            >
              <Trash2 class="h-5 w-5 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-medium">{$t('settings_page.security.delete_account')}</div>
                <div class="text-sm text-muted-foreground">
                  {$t('settings_page.security.delete_account_desc')}
                </div>
              </div>
              <ChevronRight class="h-5 w-5 shrink-0" />
            </a>
          </div>
        </div>
      {/if}

      <!-- Data -->
      <div class="space-y-1">
        <h2 class="text-lg font-semibold mb-3">{$t('settings_page.data')}</h2>
        <div class="space-y-1">
          <!-- Storage usage -->
          {#if $authStore.isAuthenticated}
            <div class="px-4 py-3 rounded-lg">
              <div class="flex items-center gap-3 mb-2">
                <HardDrive class="h-5 w-5 text-muted-foreground shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="font-medium">{$t('storage.title')}</div>
                  {#if $quotaLoading}
                    <div class="text-sm text-muted-foreground">…</div>
                  {:else}
                    <div class="text-sm text-muted-foreground">
                      {$t('storage.usage', {
                        values: {
                          used: formatBytes($quotaUsedBytes),
                          limit: formatBytes($quotaLimitBytes)
                        }
                      })}
                      · {$t('storage.percent', { values: { percent: Math.round($quotaPercent) } })}
                    </div>
                  {/if}
                </div>
              </div>
              {#if !$quotaLoading && $quotaLimitBytes > 0}
                <div class="ml-8 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-300
                      {$isOverQuota
                      ? 'bg-destructive'
                      : $isQuotaWarning
                        ? 'bg-amber-500'
                        : 'bg-primary'}"
                    style="width: {Math.min($quotaPercent, 100)}%"
                  ></div>
                </div>
                <ul class="ml-8 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <li>
                    <span class="font-medium text-foreground">{$t('storage.breakdown.notes')}:</span>
                    {formatBytes($quotaNotesBytes)}
                  </li>
                  <li>
                    <span class="font-medium text-foreground"
                      >{$t('storage.breakdown.versions')}:</span
                    >
                    {formatBytes($quotaVersionsBytes)}
                  </li>
                  <li>
                    <span class="font-medium text-foreground"
                      >{$t('storage.breakdown.shares')}:</span
                    >
                    {formatBytes($quotaSharesBytes)}
                  </li>
                </ul>
                {#if $isOverQuota}
                  <p class="ml-8 mt-1.5 text-xs text-destructive">{$t('storage.exceeded')}</p>
                {:else if $isQuotaWarning}
                  <p class="ml-8 mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    {$t('storage.warning')}
                  </p>
                {/if}
                <button
                  type="button"
                  class="ml-8 mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  onclick={() => (storageInfoExpanded = !storageInfoExpanded)}
                >
                  <ChevronDown
                    class="h-3.5 w-3.5 transition-transform duration-200 {storageInfoExpanded ? 'rotate-180' : ''}"
                  />
                  {$t('storage.learn_more')}
                </button>
                {#if storageInfoExpanded}
                  <p class="ml-8 mt-2 text-xs text-muted-foreground leading-relaxed">
                    {$t('storage.info')}
                  </p>
                {/if}
              {/if}
            </div>
          {/if}
          <a href={resolve('/settings/import-export')} class={itemClasses}>
            <FileDown class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.export_import.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.export_import.hub_export_desc')}
              </div>
            </div>
            <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
          </a>
        </div>
      </div>

      <!-- Information -->
      <div class="space-y-1">
        <h2 class="text-lg font-semibold mb-3">{$t('settings_page.information')}</h2>
        <div class="space-y-1">
          <div class={itemClasses}>
            <Info class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.about.name')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.about.version')}
                {__APP_VERSION__}
              </div>
            </div>
          </div>
          <div class={itemClasses}>
            <Scale class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.about.license')}</div>
              <div class="text-sm text-muted-foreground">{$t('brand.license')}</div>
            </div>
          </div>
          <div class="px-4 pt-2 pb-1">
            <p class="text-xs text-muted-foreground">
              {$t('brand.copyright', { values: { years: '2025' } })}
            </p>
          </div>
        </div>
      </div>

      <!-- External links -->
      <div class="space-y-1">
        <h2 class="text-lg font-semibold mb-3">{$t('settings_page.links.title')}</h2>
        <!-- eslint-disable svelte/no-navigation-without-resolve -- external links -->
        <div class="space-y-1">
          <a href={taskUrl} class={itemClasses}>
            <CheckSquare class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.about.open_task')}</div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href={buildSiteUrl('')}
            target="_blank"
            rel="noopener noreferrer"
            class={itemClasses}
          >
            <Globe class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.links.website.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.links.website.description')}
              </div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href={buildSiteUrl('/#faq')}
            target="_blank"
            rel="noopener noreferrer"
            class={itemClasses}
          >
            <CircleHelp class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.links.faq.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.links.faq.description')}
              </div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href={buildSiteUrl('/privacy')}
            target="_blank"
            rel="noopener noreferrer"
            class={itemClasses}
          >
            <FileText class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.links.privacy_policy.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.links.privacy_policy.description')}
              </div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href={buildSiteUrl('/terms')}
            target="_blank"
            rel="noopener noreferrer"
            class={itemClasses}
          >
            <Scale class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.links.terms.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.links.terms.description')}
              </div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href="https://github.com/fundacja-reborn/reapps"
            target="_blank"
            rel="noopener noreferrer"
            class={itemClasses}
          >
            <GithubMark class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.links.github.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.links.github.description')}
              </div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href="https://github.com/fundacja-reborn/reapps?tab=security-ov-file#readme"
            target="_blank"
            rel="noopener noreferrer"
            class={itemClasses}
          >
            <ShieldAlert class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.links.security_policy.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.links.security_policy.description')}
              </div>
            </div>
            <ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
        </div>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </div>
    </div>
  </div>
</div>
