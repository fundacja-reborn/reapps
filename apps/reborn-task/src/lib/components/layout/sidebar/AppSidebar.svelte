<script lang="ts">
	import {
		Home,
		Star,
		Settings,
		Palette,
		RefreshCw,
		Plus,
		NotebookPen
	} from '@lucide/svelte';
	import { base, resolve } from '$app/paths';
	import NavMain from './NavMain.svelte';
	import NavUser from './NavUser.svelte';
	import NavSettings from './NavSettings.svelte';
	import * as Sidebar from '@reborn/ui';
	import { useSidebar } from '@reborn/ui/sidebar';
	import type { ComponentProps } from 'svelte';
	import type { ListDecrypted } from '@reborn/types';
	import { t } from '$lib/stores/i18n.store';
	import { tick } from 'svelte';
	import { SearchInput } from '$lib/components/search';

	let {
		lists = [],
		activeListId = null,
		onListSelect = () => {},
		onListCreate = () => {},
		onListEdit = () => {},
		onListDelete = () => {},
		onSetDefault = () => {},
		...restProps
	}: ComponentProps<typeof Sidebar.Sidebar> & {
		lists: ListDecrypted[];
		activeListId: string | null;
		onListSelect: (listId: string) => void;
		onListCreate: () => void;
		onListEdit: (list: ListDecrypted) => void;
		onListDelete: (list: ListDecrypted) => void;
		onSetDefault: (list: ListDecrypted) => void;
	} = $props();

	// Data for settings menu
	const settingsData = {
		items: [
			{
				title: $t('settings.theme'),
				iconName: 'palette',
				action: 'theme'
			},
			{
				title: $t('settings.app_settings'),
				url: '/settings',
				iconName: 'settings'
			},
			{
				title: $t('sync.sync_now'),
				iconName: 'refresh',
				action: 'sync'
			}
		]
	};

	// Notes app URL (configurable via PUBLIC_NOTES_URL env var)
	const notesUrl: string =
		(import.meta.env.PUBLIC_NOTES_URL as string | undefined) ?? 'http://localhost:4201';

	// Get sidebar context
	const sidebar = useSidebar();

	// Handle create list click
	async function handleCreateList() {
		onListCreate();
		// Close sidebar on mobile after action
		if (sidebar.isMobile) {
			await tick();
			sidebar.setOpenMobile(false);
		}
	}
</script>

<Sidebar.Sidebar collapsible="offcanvas" {...restProps}>
	<Sidebar.SidebarHeader>
		<Sidebar.SidebarMenu>
			<Sidebar.SidebarMenuItem>
				<div class="flex items-center gap-0.5">
					<Sidebar.SidebarMenuButton class="data-[slot=sidebar-menu-button]:!p-1.5 min-w-0 flex-1">
						{#snippet child({ props })}
							<a href={resolve('/')} {...props}>
								<img
									src="{base}/logo-black.svg"
									alt="re/task"
									class="h-4 w-auto block dark:hidden"
								/>
								<img
									src="{base}/logo-white.svg"
									alt="re/task"
									class="h-4 w-auto hidden dark:block dark:opacity-80"
								/>
							</a>
						{/snippet}
					</Sidebar.SidebarMenuButton>

					<!-- Open Notes app -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -- external app URL -->
					<a
						href={notesUrl}
						title="re/notes"
						aria-label="Open re/notes"
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
					>
						<NotebookPen class="h-[1.0625rem] w-[1.0625rem]" />
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</div>
			</Sidebar.SidebarMenuItem>
		</Sidebar.SidebarMenu>

		<!-- Search input -->
		<SearchInput />
	</Sidebar.SidebarHeader>

	<Sidebar.SidebarContent>
		<!-- Task lists section -->
		<NavMain {lists} {activeListId} {onListSelect} {onListEdit} {onListDelete} {onSetDefault} />

		<!-- Add new list button -->
		<div class="px-2 pb-2">
			<button
				onclick={handleCreateList}
				class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
			>
				<Plus class="h-4 w-4" />
				<span>{$t('task.sidebar.new_list')}</span>
			</button>
		</div>

		<!-- Settings menu section -->
		<NavSettings items={settingsData.items} class="mt-auto" />
	</Sidebar.SidebarContent>

	<Sidebar.SidebarFooter>
		<NavUser />
	</Sidebar.SidebarFooter>
</Sidebar.Sidebar>
