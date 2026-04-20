<script lang="ts">
	import { User, Settings, LogOut, MoreVertical } from '@lucide/svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '@reborn/ui';
	import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup, DropdownMenuItem } from '@reborn/ui';
	import * as Sidebar from '@reborn/ui';
	import { t } from '$lib/stores/i18n.store';
	import { user } from '$lib/stores/auth.store';
	import { authOperationsService } from '$lib/services/auth-operations.service';
	import { goto } from '$lib/utils/navigation';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('task:nav-user');

	const sidebarContext = Sidebar.useSidebar();

	async function handleLogout() {
		try {
			await authOperationsService.logout();
		} catch (error: unknown) {
			logger.error('Logout failed:', error);
		}
	}
</script>

<Sidebar.SidebarMenu>
	<Sidebar.SidebarMenuItem>
		<DropdownMenu>
			<DropdownMenuTrigger>
				{#snippet child({ props })}
					<Sidebar.SidebarMenuButton
						{...props}
						size="lg"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<Avatar class="size-8 rounded-lg">
							<AvatarImage src="" alt={$user?.username || 'User'} />
							<AvatarFallback class="rounded-lg">
								{$user?.username?.charAt(0).toUpperCase() || 'U'}
							</AvatarFallback>
						</Avatar>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{$user?.username || 'User'}</span>
						</div>
						<MoreVertical class="ml-auto size-4" />
					</Sidebar.SidebarMenuButton>
				{/snippet}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={sidebarContext.isMobile ? "bottom" : "right"}
				align="end"
				sideOffset={4}
			>
				<DropdownMenuLabel class="p-0 font-normal">
					<div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
						<Avatar class="size-8 rounded-lg">
							<AvatarImage src="" alt={$user?.username || 'User'} />
							<AvatarFallback class="rounded-lg">
								{$user?.username?.charAt(0).toUpperCase() || 'U'}
							</AvatarFallback>
						</Avatar>
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{$user?.username || 'User'}</span>
						</div>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem onclick={() => goto('/profile')}>
						<User class="mr-2 h-4 w-4" />
						{$t('profile.title')}
					</DropdownMenuItem>
					<DropdownMenuItem onclick={() => goto('/settings')}>
						<Settings class="mr-2 h-4 w-4" />
						{$t('settings.title')}
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onclick={handleLogout}>
					<LogOut class="mr-2 h-4 w-4" />
					{$t('common.logout')}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	</Sidebar.SidebarMenuItem>
</Sidebar.SidebarMenu>
