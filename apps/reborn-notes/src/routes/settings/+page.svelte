<script lang="ts">
  import { resolve } from '$app/paths';
  import {
    Palette,
    Info,
    CheckSquare,
    FileDown,
    FolderSync,
    DatabaseBackup,
    LogOut,
    Lock,
    ShieldCheck,
    Shield,
    Trash2,
    LayoutList,
    Share2,
    Fingerprint,
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
    CalendarDays,
    Sparkles,
    SlidersHorizontal
  } from '@lucide/svelte';
  import { goto } from '$lib/utils/navigation';
  import {
    getNativeVersionInfo,
    type NativeVersionInfo
  } from '$lib/utils/native-version-info';
  import { t } from '$lib/stores/i18n.store';
  import { locale } from '$lib/stores/i18n.store';
  import { cn, GithubMark } from '@reborn/ui';
  import { authStore } from '$lib/stores/auth.store';
  import AccountRequiredDialog from '$lib/components/shared/AccountRequiredDialog.svelte';
  import { openWhatsNew } from '$lib/stores/whats-new.svelte';
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

  // Native-only: store-installed version + live backend version (drift detail).
  // Null on web - the single __APP_VERSION__ line stays unchanged there.
  let versionInfo = $state<NativeVersionInfo | null>(null);

  onMount(() => {
    if ($authStore.isAuthenticated) {
      void refreshQuota();
    }
    void getNativeVersionInfo().then((info) => {
      versionInfo = info;
    });
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

  // Account-only security features, surfaced as locked rows in local-only mode
  // so users see what registering unlocks (clicking opens the account-required
  // prompt, mirroring the Share affordance). Curated to genuine account *value* -
  // management-only items (password change, sessions, delete account) are
  // meaningless without an account and stay hidden.
  const lockedAccountSecurityItems = [
    // App Lock (biometric) is native-only. Surfaced first so a local-mode user
    // on a device with biometrics sees it as an account perk: the gate needs
    // the master key in the device vault (the account-mode posture), whereas
    // local mode locks with the passcode - a real at-rest crypto wrap that
    // purges the vault. So biometric unlock and the local passcode stay
    // separate, and biometrics belong here under "available with an account".
    // Reuses the App Lock copy; the compile-time guard drops it from web.
    ...(__REBORN_NATIVE__
      ? [
          {
            icon: Fingerprint,
            title: $t('app_lock.settings_item_title'),
            description: $t('app_lock.settings_item_desc')
          }
        ]
      : []),
    {
      icon: Shield,
      title: $t('settings_page.security.two_factor'),
      description: $t('settings_page.security.two_factor_desc')
    },
    {
      icon: ShieldCheck,
      title: $t('settings_page.security.recovery_codes'),
      description: $t('settings_page.security.recovery_codes_desc')
    },
    {
      icon: Share2,
      title: $t('share.list.settings_title'),
      description: $t('share.list.settings_desc')
    }
  ];

  let accountRequiredOpen = $state(false);
</script>

<svelte:head>
  <title>{$t('settings_page.title')} — re/notes</title>
</svelte:head>

<!-- height: subtract the session-expired banner so it does not push the page
     bottom off screen (var is 0 when the banner is hidden) -->
<div class="h-[calc(100dvh-var(--rn-banner-h,0px))] overflow-y-auto bg-background">
  <!-- pt: keep the header below the iOS notch/Dynamic Island (env() is 0 elsewhere) -->
  <div class="sticky top-0 z-10 bg-background border-b pt-[env(safe-area-inset-top,0px)]">
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
      <!-- Account (real server account only; local-only shows the invite below) -->
      {#if $authStore.isAuthenticated}
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
      {/if}

      <!-- Local-only: invite to create an account (adopts the local key, keeps notes).
           Placed before Preferences so "Account" stays the first section, matching
           the authenticated layout. -->
      {#if $authStore.isLocalOnly}
        <div class="space-y-1">
          <h2 class="text-lg font-semibold mb-3">{$t('settings_page.account.title')}</h2>
          <div class="space-y-1">
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a href={resolveHref('/auth/register')} class={itemClasses}>
              <User class="h-5 w-5 text-muted-foreground shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-medium">{$t('settings_page.account.create')}</div>
                <div class="text-sm text-muted-foreground">
                  {$t('settings_page.account.create_desc')}
                </div>
              </div>
              <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
            </a>
            <!-- Backup nudge: creating an account, or signing into another one, runs
                 clearAllUserData and replaces local notes - suggest an export first. -->
            <a href={resolve('/settings/import-export')} class={itemClasses}>
              <FileDown class="h-5 w-5 text-muted-foreground shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-sm text-muted-foreground">
                  {$t('local_mode.backup_hint')}
                </div>
              </div>
              <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
            </a>
          </div>
        </div>
      {/if}
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
          <a href={resolve('/settings/behavior')} class={itemClasses}>
            <SlidersHorizontal class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.behavior.title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.behavior.hub_desc')}
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

      <!-- Security (local-only mode: device passcode + locked account features) -->
      {#if $authStore.isLocalOnly}
        <div class="space-y-1">
          <h2 class="text-lg font-semibold mb-3">{$t('settings_page.security.title')}</h2>
          <div class="space-y-1">
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
            <a href={resolveHref('/settings/security/passcode')} class={itemClasses}>
              <Lock class="h-5 w-5 text-muted-foreground shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="font-medium">{$t('local_mode.passcode.settings_item_title')}</div>
                <div class="text-sm text-muted-foreground">
                  {$t('local_mode.passcode.settings_item_desc')}
                </div>
              </div>
              <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
            </a>
          </div>

          <!-- Account-only features, shown locked to surface what registering
               unlocks. Each opens the account-required prompt (like Share). -->
          <h3 class="text-sm font-medium text-muted-foreground mt-5 mb-2 px-4">
            {$t('local_mode.account_features_title')}
          </h3>
          <div class="space-y-1">
            {#each lockedAccountSecurityItems as item (item.title)}
              <button
                type="button"
                onclick={() => (accountRequiredOpen = true)}
                class={cn(itemClasses, 'w-full text-left opacity-60')}
              >
                <item.icon class="h-5 w-5 text-muted-foreground shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="font-medium">{item.title}</div>
                  <div class="text-sm text-muted-foreground">{item.description}</div>
                </div>
                <Lock class="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Security -->
      {#if $authStore.isAuthenticated}
        <div class="space-y-1">
          <h2 class="text-lg font-semibold mb-3">{$t('settings_page.security.title')}</h2>
          <div class="space-y-1">
            {#if __REBORN_NATIVE__}
              <!-- App Lock (biometric) - native only, surfaced first in the
                   section (UX). The master key must live in the device vault for
                   the biometric gate to read it back, the account-mode posture
                   on native. -->
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a href={resolveHref('/settings/security/app-lock')} class={itemClasses}>
                <Fingerprint class="h-5 w-5 text-muted-foreground shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="font-medium">{$t('app_lock.settings_item_title')}</div>
                  <div class="text-sm text-muted-foreground">
                    {$t('app_lock.settings_item_desc')}
                  </div>
                </div>
                <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
              </a>
            {/if}

            {#each securityItems as item}
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
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
          <a href={resolve('/settings/folder-sync')} class={itemClasses}>
            <FolderSync class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">
                {$t('settings_page.export_import.folder_sync_title')}
              </div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.export_import.folder_sync_hub_desc')}
              </div>
            </div>
            <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
          </a>
          <a href={resolve('/settings/backup')} class={itemClasses}>
            <DatabaseBackup class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('settings_page.backup.hub_title')}</div>
              <div class="text-sm text-muted-foreground">
                {$t('settings_page.backup.hub_desc')}
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
              {#if versionInfo}
                <!-- Native: store-installed version, then the frozen bundled
                     frontend vs the live backend so the drift is visible. -->
                <div class="text-sm text-muted-foreground">
                  {$t('settings_page.about.version')}
                  {$t('settings_page.about.native_app_version', {
                    values: { version: versionInfo.appVersion, build: versionInfo.appBuild }
                  })}
                </div>
                <div class="text-xs text-muted-foreground">
                  {$t('settings_page.about.frontend_version')}
                  {__APP_VERSION__}
                  <span aria-hidden="true" class="px-0.5">·</span>
                  {$t('settings_page.about.backend_version')}
                  {versionInfo.backendVersion ?? '-'}
                </div>
              {:else}
                <div class="text-sm text-muted-foreground">
                  {$t('settings_page.about.version')}
                  {__APP_VERSION__}
                </div>
              {/if}
            </div>
          </div>
          <button
            type="button"
            onclick={() => openWhatsNew()}
            class={cn(itemClasses, 'w-full text-left')}
          >
            <Sparkles class="h-5 w-5 text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="font-medium">{$t('whats_new.settings_row')}</div>
              <div class="text-sm text-muted-foreground">{$t('whats_new.settings_row_desc')}</div>
            </div>
            <ChevronRight class="h-5 w-5 text-muted-foreground shrink-0" />
          </button>
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

<!-- Account-required prompt (locked security feature tapped in local-only mode) -->
<AccountRequiredDialog bind:open={accountRequiredOpen} />
