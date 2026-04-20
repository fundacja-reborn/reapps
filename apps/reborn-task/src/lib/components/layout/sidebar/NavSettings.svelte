<script lang="ts">
	import * as Sidebar from '@reborn/ui';
	import { useSidebar } from '@reborn/ui/sidebar';
	import { cn, toastStore } from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { theme, toggleTheme } from '$lib/stores/theme.store';
	import { syncService, syncProgress } from '$lib/services/sync.service';
	import { Info, Palette, Settings, RefreshCw } from '@lucide/svelte';
	import { tick } from 'svelte';
	import { goto } from '$lib/utils/navigation';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:nav-settings');

	let {
		items,
		class: className,
		...restProps
	} = $props<{
		items: Array<{
			title: string;
			url?: string;
			iconName: string;
			action?: string;
		}>;
		class?: string;
	}>();

	let isSyncing = $state(false);

	// Get sidebar context
	const sidebar = useSidebar();

	async function handleAction(action: string) {
		switch (action) {
			case 'theme':
				toggleTheme();
				toastStore.success($t('settings.theme_changed'));
				break;
			
			case 'sync':
				if (isSyncing || $syncProgress.isInProgress) return;
				
				isSyncing = true;
				try {
					await syncService.syncToServer();
					await syncService.initialSync();
					toastStore.success($t('sync.success'));
				} catch (error: unknown) {
					logger.error('Manual sync failed:', error);
					toastStore.error($t('sync.failed'));
				} finally {
					isSyncing = false;
				}
				break;
		}
	}

	async function handleItemClick(item: typeof items[0]) {
		if (item.action) {
			handleAction(item.action);
		}
		// Close sidebar on mobile after action
		if (sidebar.isMobile) {
			await tick();
			sidebar.setOpenMobile(false);
		}
	}

	async function handleLinkClick(url: string) {
		// Close sidebar on mobile before navigation
		if (sidebar.isMobile) {
			await tick();
			sidebar.setOpenMobile(false);
		}
		goto(url);
	}

	// Map icon names to components
	function getIcon(iconName: string) {
		switch (iconName) {
			case 'info':
				return Info;
			case 'palette':
				return Palette;
			case 'settings':
				return Settings;
			case 'refresh':
				return RefreshCw;
			default:
				return Info;
		}
	}
</script>

<Sidebar.SidebarGroup class={cn(className)}>
	<Sidebar.SidebarGroupLabel>{$t('settings.title')}</Sidebar.SidebarGroupLabel>
	<Sidebar.SidebarMenu>
		{#each items as item}
			{@const IconComponent = getIcon(item.iconName)}
			<Sidebar.SidebarMenuItem>
				{#if item.url}
					<Sidebar.SidebarMenuButton onclick={() => handleLinkClick(item.url!)}>
						<IconComponent class="h-4 w-4" />
						<span>{item.title}</span>
					</Sidebar.SidebarMenuButton>
				{:else}
					<Sidebar.SidebarMenuButton onclick={() => handleItemClick(item)}>
						<IconComponent 
							class="h-4 w-4 {item.action === 'sync' && (isSyncing || $syncProgress.isInProgress) ? 'animate-spin' : ''}" 
						/>
						<span>
							{#if item.action === 'sync' && (isSyncing || $syncProgress.isInProgress)}
								{$syncProgress.message || $t('sync.syncing')}
							{:else}
								{item.title}
							{/if}
						</span>
					</Sidebar.SidebarMenuButton>
				{/if}
			</Sidebar.SidebarMenuItem>
		{/each}
	</Sidebar.SidebarMenu>
</Sidebar.SidebarGroup>
