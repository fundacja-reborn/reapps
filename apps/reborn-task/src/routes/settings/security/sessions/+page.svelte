<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { onMount } from 'svelte';
	import { Monitor, LogOut, RefreshCw, AlertTriangle, X } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { SettingsLayout, Button, Alert, AlertDescription } from '@reborn/ui';
	import { toast } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';
	import { cryptoManager } from '@reborn/crypto';
	import { authOperationsService } from '$lib/services/auth-operations.service';

	const logger = createLogger('SessionsPage');

	type Session = {
		id: string;
		login_at: string;
		expires_at: string;
		device_info_encrypted: string | null;
	};

	let sessions = $state<Session[]>([]);
	let currentSessionId = $state<string | null>(null);
	let loadingSessions = $state(true);
	let isLoggingOut = $state(false);
	let showLogoutAllConfirm = $state(false);
	let revokingSessionId = $state<string | null>(null);
	let revokingAll = $state(false);
	let sessionsError = $state<string | null>(null);
	let decryptedDeviceNames = $state<Record<string, string>>({});

	const currentSession = $derived(sessions.find((s) => s.id === currentSessionId));
	const otherSessions = $derived(sessions.filter((s) => s.id !== currentSessionId));

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function getDeviceName(sessionId: string): string {
		return decryptedDeviceNames[sessionId] ?? $t('settings.security.sessions.unknown_device');
	}

	async function decryptDeviceNames(items: Session[]): Promise<void> {
		if (!cryptoManager.isInitialized()) return;
		const result: Record<string, string> = {};
		await Promise.all(
			items.map(async (s) => {
				if (s.device_info_encrypted) {
					try {
						result[s.id] = await cryptoManager.decryptText(s.device_info_encrypted);
					} catch {
						result[s.id] = $t('settings.security.sessions.unknown_device');
					}
				}
			})
		);
		decryptedDeviceNames = result;
	}

	async function loadSessions() {
		loadingSessions = true;
		sessionsError = null;
		try {
			const accessToken = localStorage.getItem('access_token');
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/sessions`, {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();
			if (data.success) {
				sessions = data.data;
				currentSessionId = data.currentSessionId ?? null;
				await decryptDeviceNames(sessions);
			} else {
				sessionsError = $t('settings.security.sessions.error_load');
			}
		} catch (err: unknown) {
			logger.error('Failed to load sessions:', err);
			sessionsError = $t('settings.security.sessions.error_load');
		} finally {
			loadingSessions = false;
		}
	}

	async function revokeSession(sessionId: string) {
		revokingSessionId = sessionId;
		try {
			const accessToken = localStorage.getItem('access_token');
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/sessions/${sessionId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();
			if (data.success) {
				sessions = sessions.filter((s) => s.id !== sessionId);
				toast.success($t('settings.security.sessions.revoke_success'));
			} else {
				toast.error($t('settings.security.sessions.revoke_error'));
			}
		} catch (err: unknown) {
			logger.error('Failed to revoke session:', err);
			toast.error($t('settings.security.sessions.revoke_error'));
		} finally {
			revokingSessionId = null;
		}
	}

	async function revokeAllOther() {
		revokingAll = true;
		try {
			const accessToken = localStorage.getItem('access_token');
			await Promise.all(
				otherSessions.map(async (s) => {
					const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/sessions/${s.id}`, {
						method: 'DELETE',
						headers: { Authorization: `Bearer ${accessToken}` }
					});
					const data = await response.json();
					if (data.success) {
						sessions = sessions.filter((x) => x.id !== s.id);
					}
				})
			);
		} catch (err: unknown) {
			logger.error('Failed to revoke all other sessions:', err);
			toast.error($t('settings.security.sessions.revoke_error'));
		} finally {
			revokingAll = false;
		}
	}

	async function logoutAll() {
		isLoggingOut = true;
		showLogoutAllConfirm = false;
		try {
			toast.success($t('settings.security.sessions.logout_all_success'));
			await authOperationsService.logoutAllDevices();
		} catch (err: unknown) {
			logger.error('Failed to logout all:', err);
			toast.error($t('settings.security.sessions.logout_all_error'));
		} finally {
			isLoggingOut = false;
		}
	}

	onMount(() => {
		loadSessions();
	});
</script>

<SettingsLayout title={$t('settings.security.sessions.title')} backHref="/settings">
	{#snippet actions()}
		<button
			type="button"
			onclick={loadSessions}
			disabled={loadingSessions}
			aria-label="Refresh"
			class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
		>
			<RefreshCw class="h-4 w-4 {loadingSessions ? 'animate-spin' : ''}" />
		</button>
	{/snippet}

	<div class="space-y-4">
		{#if sessionsError}
			<div
				class="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
			>
				{sessionsError}
			</div>
		{:else if loadingSessions}
			<div class="flex justify-center py-12">
				<RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if sessions.length === 0}
			<div class="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
				{$t('settings.security.sessions.no_sessions')}
			</div>
		{:else}
			<!-- Current session -->
			{#if currentSession}
				<div class="rounded-lg border border-primary/30 bg-card">
					<div class="flex items-center gap-3 px-4 py-3">
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"
						>
							<Monitor class="h-4 w-4 text-primary" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<p class="truncate text-sm font-medium">
									{getDeviceName(currentSession.id)}
								</p>
								<span
									class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
								>
									{$t('settings.security.sessions.current_session')}
								</span>
							</div>
							<p class="text-xs text-muted-foreground">
								{$t('settings.security.sessions.logged_in')}: {formatDate(currentSession.login_at)}
							</p>
							<p class="text-xs text-muted-foreground">
								{$t('settings.security.sessions.expires')}: {formatDate(currentSession.expires_at)}
							</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Other sessions -->
			{#if otherSessions.length > 0}
				<div class="flex items-center justify-between">
					<p class="text-xs font-medium text-muted-foreground">
						{$t('settings.security.sessions.other_sessions', {
							values: { count: otherSessions.length }
						})}
					</p>
					<button
						type="button"
						onclick={revokeAllOther}
						disabled={revokingAll}
						class="rounded-md border px-3 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
					>
						{revokingAll
							? $t('settings.security.sessions.revoking_all')
							: $t('settings.security.sessions.revoke_all')}
					</button>
				</div>

				<div class="rounded-lg border bg-card divide-y">
					{#each otherSessions as session (session.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
								<Monitor class="h-4 w-4 text-muted-foreground" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{getDeviceName(session.id)}
								</p>
								<p class="text-xs text-muted-foreground">
									{$t('settings.security.sessions.logged_in')}: {formatDate(session.login_at)}
								</p>
								<p class="text-xs text-muted-foreground">
									{$t('settings.security.sessions.expires')}: {formatDate(session.expires_at)}
								</p>
							</div>
							<button
								type="button"
								onclick={() => revokeSession(session.id)}
								disabled={revokingSessionId === session.id || revokingAll}
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
								aria-label={$t('settings.security.sessions.revoke_session')}
							>
								{#if revokingSessionId === session.id}
									<RefreshCw class="h-4 w-4 animate-spin" />
								{:else}
									<X class="h-4 w-4" />
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Logout all devices -->
			{#if !showLogoutAllConfirm}
				<Button
					variant="destructive"
					onclick={() => (showLogoutAllConfirm = true)}
					disabled={isLoggingOut}
					class="w-full mt-2"
				>
					<LogOut class="h-4 w-4 mr-2" />
					{$t('settings.security.sessions.logout_all_button')}
				</Button>
			{:else}
				<Alert variant="destructive">
					<AlertTriangle class="h-4 w-4" />
					<AlertDescription>
						{$t('settings.security.sessions.logout_all_confirm')}
					</AlertDescription>
				</Alert>
				<div class="flex gap-2 flex-wrap mt-2">
					<Button variant="destructive" onclick={logoutAll} disabled={isLoggingOut}>
						{isLoggingOut
							? $t('common.loading') || 'Logging out...'
							: $t('settings.security.sessions.logout_all_button')}
					</Button>
					<Button
						variant="outline"
						onclick={() => (showLogoutAllConfirm = false)}
						disabled={isLoggingOut}
					>
						{$t('common.cancel') || 'Cancel'}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</SettingsLayout>
