<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { onMount } from 'svelte';
	import {
		Palette,
		Bell,
		Shield,
		Info,
		Lock,
		FileDown,
		FileUp,
		Monitor,
		RefreshCw,
		ShieldCheck,
		Trash2,
		ExternalLink,
		Globe,
		CircleHelp,
		FileText,
		Scale,
		User,
		LogOut,
		StickyNote,
		ShieldAlert,
		Share2,
		UserPlus
	} from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { locale } from '$lib/stores/i18n.store';
	import { cn, SettingsLayout, GithubMark } from '@reborn/ui';
	import { user, isAuthenticated, isLocalOnly } from '$lib/stores/auth.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { resolve } from '$app/paths';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('SettingsPage');

	// Bypass SvelteKit typed routes for dynamic string hrefs
	const resolveHref = resolve as unknown as (path: string) => string;

	const siteBaseUrl: string =
		(import.meta.env.PUBLIC_SITE_URL as string | undefined) ?? 'https://reapps.eu';

	const notesUrl: string =
		(import.meta.env.PUBLIC_NOTES_URL as string | undefined) ?? 'https://reapps.eu/notes';

	function siteUrl(path: string): string {
		const prefix = $locale !== 'en' ? '/' + $locale : '';
		return `${siteBaseUrl}${prefix}${path}`;
	}

	async function handleLogout() {
		await authOperationsService.logout();
	}

	// Settings structure
	const preferencesSections = [
		{
			title: $t('settings.preferences'),
			items: [
				{
					icon: Palette,
					title: $t('settings.appearance.title'),
					description: $t('settings.appearance.expanded_description', {
						default: 'Motyw aplikacji, język interfejsu, format daty i czasu'
					}),
					href: '/settings/appearance'
				},
				{
					icon: Bell,
					title: $t('settings.notifications.title'),
					description: $t('settings.notifications.expanded_description', {
						default: 'Włączanie powiadomień, dźwięki, czas przypomnień, dzienny raport'
					}),
					href: '/settings/notifications'
				}
			]
		}
	];

	const securityItems = [
		{
			icon: Lock,
			title: $t('settings.security.password.title', { default: 'Zmiana hasła' }),
			description: $t('settings.security.password.description', {
				default: 'Zmień hasło do swojego konta'
			}),
			href: '/settings/security/password'
		},
		{
			icon: ShieldCheck,
			title: $t('settings.security.backup_codes.title', { default: 'Kody zapasowe' }),
			description: $t('settings.security.backup_codes.description', {
				default: 'Jednorazowe kody dostępu awaryjnego'
			}),
			href: '/settings/security/recovery-codes'
		},
		{
			icon: Shield,
			title: $t('settings.security.two_factor.title', { default: 'Weryfikacja dwuetapowa' }),
			description: $t('settings.security.two_factor.description', {
				default: 'Dodatkowe zabezpieczenie konta'
			}),
			href: '/settings/security/two-factor'
		}
	];

	const dataSections = [
		{
			title: $t('settings.data'),
			items: [
				{
					icon: FileDown,
					title: $t('settings.import_export.export_title', { default: 'Eksport danych' }),
					description: $t('settings.import_export.export_description', {
						default: 'Pobierz kopię swoich zadań i list'
					}),
					href: '/settings/import-export#export'
				},
				{
					icon: FileUp,
					title: $t('settings.import_export.import_title', { default: 'Import danych' }),
					description: $t('settings.import_export.import_description', {
						default: 'Przywróć dane z kopii zapasowej'
					}),
					href: '/settings/import-export#import'
				}
			]
		}
	];

	const linkItems = [
		{
			icon: Globe,
			title: $t('settings.links.website.title'),
			description: $t('settings.links.website.description'),
			href: siteBaseUrl
		},
		{
			icon: CircleHelp,
			title: $t('settings.links.faq.title'),
			description: $t('settings.links.faq.description'),
			href: siteUrl('/#faq')
		},
		{
			icon: FileText,
			title: $t('settings.links.privacy_policy.title'),
			description: $t('settings.links.privacy_policy.description'),
			href: siteUrl('/privacy')
		},
		{
			icon: Scale,
			title: $t('settings.links.terms.title'),
			description: $t('settings.links.terms.description'),
			href: siteUrl('/terms')
		},
		{
			icon: GithubMark,
			title: $t('settings.links.github.title'),
			description: $t('settings.links.github.description'),
			href: 'https://github.com/fundacja-reborn/reapps'
		},
		{
			icon: ShieldAlert,
			title: $t('settings.links.security_policy.title'),
			description: $t('settings.links.security_policy.description'),
			href: 'https://github.com/fundacja-reborn/reapps?tab=security-ov-file#readme'
		}
	];

	// Sessions count
	let sessionsCount = $state<number | null>(null);
	let loadingSessions = $state(true);

	async function loadSessionsCount() {
		const accessToken = localStorage.getItem('access_token');
		// Local-only mode has no account/token - the sessions UI is hidden anyway.
		if (!accessToken) {
			loadingSessions = false;
			return;
		}
		try {
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/sessions`, {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();
			if (data.success) {
				sessionsCount = data.data.length;
			}
		} catch (err: unknown) {
			logger.error('Failed to load sessions count:', err);
		} finally {
			loadingSessions = false;
		}
	}

	onMount(() => {
		loadSessionsCount();
	});

	const itemClasses = cn(
		'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 rounded-lg'
	);
</script>

<SettingsLayout title={$t('settings.title')} backHref="/">
	<p class="text-sm text-muted-foreground mb-8">{$t('settings.about.description')}</p>

	<div class="space-y-8">
		<!-- Account (real account session) -->
		{#if $isAuthenticated}
			<div class="space-y-1">
				<h2 class="text-lg font-semibold mb-3">{$t('settings.account.title')}</h2>
				<div class="space-y-1">
					<div class={itemClasses}>
						<User class="h-5 w-5 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<div class="font-medium">{$user?.username ?? 'User'}</div>
							<div class="text-sm text-muted-foreground">
								{#if $user?.created_at}
									{$t('profile.member_since')}
									{new Date($user.created_at).toLocaleDateString(
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
							<div class="font-medium">{$t('settings.account.log_out')}</div>
						</div>
					</button>
				</div>
			</div>
		{:else if $isLocalOnly}
			<!-- Local-only mode: invite to create an account (keeps existing tasks) -->
			<div class="space-y-1">
				<h2 class="text-lg font-semibold mb-3">{$t('settings.account.title')}</h2>
				<a href={resolve('/auth/register')} class={itemClasses}>
					<UserPlus class="h-5 w-5 text-primary shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('local_mode.create_account')}</div>
						<div class="text-sm text-muted-foreground">
							{$t('local_mode.account_invite_desc')}
						</div>
					</div>
				</a>
				<div class="px-4 pt-1">
					<p class="text-xs text-muted-foreground">{$t('local_mode.backup_reminder')}</p>
				</div>
			</div>
		{/if}
		<!-- Preferences sections -->
		{#each preferencesSections as section}
			<div class="space-y-1">
				<h2 class="text-lg font-semibold mb-3">{section.title}</h2>
				<div class="space-y-1">
					{#each section.items as item}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={resolveHref(item.href)} class={itemClasses}>
							<item.icon class="h-5 w-5 text-muted-foreground shrink-0" />
							<div class="flex-1 min-w-0">
								<div class="font-medium">{item.title}</div>
								{#if item.description}
									<div class="text-sm text-muted-foreground">{item.description}</div>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</div>
		{/each}

		<!-- Security (local-only mode: optional device passcode) -->
		{#if $isLocalOnly}
		<div class="space-y-1">
			<h2 class="text-lg font-semibold mb-3">{$t('settings.security.title')}</h2>
			<div class="space-y-1">
				<a href={resolve('/settings/security/passcode')} class={itemClasses}>
					<Lock class="h-5 w-5 text-muted-foreground shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('local_mode.passcode.settings_item_title')}</div>
						<div class="text-sm text-muted-foreground">
							{$t('local_mode.passcode.settings_item_desc')}
						</div>
					</div>
				</a>
			</div>
		</div>
		{/if}

		<!-- Security section (account-only - hidden in local-only mode) -->
		{#if $isAuthenticated}
		<div class="space-y-1">
			<h2 class="text-lg font-semibold mb-3">{$t('settings.security.title')}</h2>

			<!-- Auth method links -->
			<div class="space-y-1">
				{#each securityItems as item}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={resolveHref(item.href)} class={itemClasses}>
						<item.icon class="h-5 w-5 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<div class="font-medium">{item.title}</div>
							{#if item.description}
								<div class="text-sm text-muted-foreground">{item.description}</div>
							{/if}
						</div>
					</a>
				{/each}

				<!-- Active read-only shares -->
				<a href={resolve('/settings/security/shares')} class={itemClasses}>
					<Share2 class="h-5 w-5 text-muted-foreground shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('share.list.settings_title')}</div>
						<div class="text-sm text-muted-foreground">
							{$t('share.list.settings_desc')}
						</div>
					</div>
				</a>

				<!-- Active sessions link with counter -->
				<a href={resolve('/settings/security/sessions')} class={itemClasses}>
					<Monitor class="h-5 w-5 text-muted-foreground shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium flex items-center gap-2">
							{$t('settings.security.sessions.title')}
							{#if loadingSessions}
								<RefreshCw class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							{:else if sessionsCount !== null}
								<span
									class="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5"
								>
									{sessionsCount}
								</span>
							{/if}
						</div>
						<div class="text-sm text-muted-foreground">
							{$t('settings.security.sessions.description')}
						</div>
					</div>
				</a>

				<!-- Delete account -->
				<a
					href={resolve('/settings/security/delete-account')}
					class={cn(itemClasses, 'text-destructive hover:bg-destructive/5')}
				>
					<Trash2 class="h-5 w-5 shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('settings.delete_account.title')}</div>
						<div class="text-sm text-muted-foreground">
							{$t('settings.delete_account.description')}
						</div>
					</div>
				</a>
			</div>
		</div>
		{/if}

		<!-- Data & Info sections -->
		{#each dataSections as section}
			<div class="space-y-1">
				<h2 class="text-lg font-semibold mb-3">{section.title}</h2>
				<div class="space-y-1">
					{#each section.items as item}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={resolveHref(item.href)} class={itemClasses}>
							<item.icon class="h-5 w-5 text-muted-foreground shrink-0" />
							<div class="flex-1 min-w-0">
								<div class="font-medium">{item.title}</div>
								{#if item.description}
									<div class="text-sm text-muted-foreground">{item.description}</div>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</div>
		{/each}

		<!-- Information -->
		<div class="space-y-1">
			<h2 class="text-lg font-semibold mb-3">{$t('settings.information')}</h2>
			<div class="space-y-1">
				<div class={itemClasses}>
					<Info class="h-5 w-5 text-muted-foreground shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('settings.about.name')}</div>
						<div class="text-sm text-muted-foreground">
							{$t('settings.about.version')}
							{__APP_VERSION__}
						</div>
					</div>
				</div>
				<div class={itemClasses}>
					<Scale class="h-5 w-5 text-muted-foreground shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('settings.about.license')}</div>
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
			<h2 class="text-lg font-semibold mb-3">{$t('settings.links.title')}</h2>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- external links -->
			<div class="space-y-1">
				<a href={notesUrl} class={itemClasses}>
					<StickyNote class="h-5 w-5 text-muted-foreground shrink-0" />
					<div class="flex-1 min-w-0">
						<div class="font-medium">{$t('settings.about.open_notes')}</div>
					</div>
					<ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
				</a>
				{#each linkItems as item}
					<a href={item.href} target="_blank" rel="noopener noreferrer" class={itemClasses}>
						<item.icon class="h-5 w-5 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<div class="font-medium">{item.title}</div>
							{#if item.description}
								<div class="text-sm text-muted-foreground">{item.description}</div>
							{/if}
						</div>
						<ExternalLink class="h-4 w-4 text-muted-foreground shrink-0" />
					</a>
				{/each}
			</div>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>
</SettingsLayout>
