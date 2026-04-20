<script lang="ts">
	import { ListTodo, Star, Search, Settings } from '@lucide/svelte';
	import { page } from '$app/stores';
	import { goto } from '$lib/utils/navigation';
	import { t } from '$lib/stores/i18n.store';
	import { cn } from '@reborn/ui/utils';
	import { useSidebar } from '@reborn/ui/sidebar';

	const sidebar = useSidebar();

	const items = [
		{
			key: 'lists',
			icon: ListTodo,
			onClick: () => sidebar.setOpenMobile(true),
			isActive: (path: string) =>
				path === '/' ||
				path.startsWith('/lists/') ||
				path === '/lists' ||
				path.startsWith('/tasks/')
		},
		{
			key: 'starred',
			icon: Star,
			onClick: () => goto('/starred'),
			isActive: (path: string) => path === '/starred'
		},
		{
			key: 'search',
			icon: Search,
			onClick: () => goto('/search'),
			isActive: (path: string) => path === '/search'
		},
		{
			key: 'settings',
			icon: Settings,
			onClick: () => goto('/settings'),
			isActive: (path: string) => path.startsWith('/settings') || path === '/profile'
		}
	];
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t bg-background"
	style="padding-bottom: env(safe-area-inset-bottom);"
>
	<div class="flex h-14 items-stretch">
		{#each items as item (item.key)}
			{@const active = item.isActive($page.url.pathname)}
			{@const Icon = item.icon}
			<button
				type="button"
				class={cn(
					'flex flex-1 flex-col items-center justify-center gap-1 min-h-11 transition-colors',
					active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
				)}
				onclick={item.onClick}
				aria-label={$t(`nav.${item.key}`)}
				aria-current={active ? 'page' : undefined}
			>
				<Icon class="h-5 w-5 shrink-0" />
				<span class="text-[11px] leading-none font-medium">{$t(`nav.${item.key}`)}</span>
			</button>
		{/each}
	</div>
</nav>
