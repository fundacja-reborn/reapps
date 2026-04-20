<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from '@reborn/ui';
	import { User, Calendar, Shield } from '@lucide/svelte';
	import { goto } from '$lib/utils/navigation';
	import { t } from '$lib/stores/i18n.store';
	import { user } from '$lib/stores/auth.store';
</script>

<div class="container mx-auto max-w-4xl p-6">
	<div class="mb-8">
		<h1 class="text-3xl font-bold tracking-tight">{$t('profile.title')}</h1>
		<p class="text-muted-foreground mt-2">
			{$t('profile.description')}
		</p>
	</div>

	<div class="space-y-6">
		<!-- User info -->
		<Card>
			<CardHeader>
				<CardTitle>{$t('profile.user_info')}</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-center gap-4">
					<User class="h-5 w-5 text-muted-foreground" />
					<div>
						<p class="text-sm font-medium">{$t('profile.username')}</p>
						<p class="text-sm text-muted-foreground">{$user?.username || 'User'}</p>
					</div>
				</div>
				
				
				<div class="flex items-center gap-4">
					<Calendar class="h-5 w-5 text-muted-foreground" />
					<div>
						<p class="text-sm font-medium">{$t('profile.member_since')}</p>
						<p class="text-sm text-muted-foreground">
							{$user?.created_at ? new Date($user.created_at).toLocaleDateString() : '-'}
						</p>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Security -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Shield class="h-5 w-5" />
					{$t('profile.security')}
				</CardTitle>
				<CardDescription>
					{$t('profile.security_description')}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div>
					<Button variant="outline" onclick={() => goto('/settings/security/password')}>
						{$t('profile.change_password')}
					</Button>
				</div>
				<div>
					<Button variant="outline" onclick={() => goto('/settings/security/two-factor')}>
						{$t('profile.enable_2fa')}
					</Button>
				</div>
			</CardContent>
		</Card>

		<!-- Danger zone -->
		<Card>
			<CardHeader>
				<CardTitle class="text-destructive">{$t('profile.danger_zone')}</CardTitle>
				<CardDescription>
					{$t('profile.danger_zone_description')}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Button variant="destructive" disabled>
					{$t('profile.delete_account')}
				</Button>
			</CardContent>
		</Card>
	</div>
</div>
