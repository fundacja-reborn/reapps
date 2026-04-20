<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$env/static/public';
	import { onMount } from 'svelte';
	import {
		SettingsLayout,
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
		Button,
		Alert,
		AlertDescription,
		Separator
	} from '@reborn/ui';
	import {
		ShieldCheck,
		ShieldAlert,
		Download,
		Copy,
		Check,
		RefreshCw,
		AlertTriangle
	} from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { toast } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';

	const logger = createLogger('RecoveryCodesPage');

	type CodesStatus = {
		hasCodesGenerated: boolean;
		totalCount: number;
		usedCount: number;
		availableCount: number;
		generatedAt: string | null;
	};

	let isLoading = $state(true);
	let isGenerating = $state(false);
	let status = $state<CodesStatus | null>(null);
	let newCodes = $state<string[]>([]);
	let showConfirmRegenerate = $state(false);
	let copiedIndex = $state<number | null>(null);
	let error = $state<string | null>(null);

	async function fetchStatus() {
		try {
			const accessToken = localStorage.getItem('access_token');
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/recovery-codes`, {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();
			if (data.success) {
				status = data.data;
			} else {
				error = $t('settings.security.backup_codes.error_load');
			}
		} catch (err: unknown) {
			logger.error('Failed to fetch recovery codes status:', err);
			error = $t('settings.security.backup_codes.error_load');
		} finally {
			isLoading = false;
		}
	}

	async function generateCodes() {
		isGenerating = true;
		showConfirmRegenerate = false;
		error = null;

		try {
			const accessToken = localStorage.getItem('access_token');
			const response = await fetch(`${PUBLIC_BASE_PATH}/api/auth/recovery-codes`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${accessToken}` }
			});
			const data = await response.json();

			if (data.success) {
				newCodes = data.data.codes;
				await fetchStatus();
				toast.success(
					$t('settings.security.backup_codes.generated_success').replace(
						'{count}',
						String(data.data.count)
					)
				);
			} else {
				error = $t('settings.security.backup_codes.error_generate');
			}
		} catch (err: unknown) {
			logger.error('Failed to generate recovery codes:', err);
			error = $t('settings.security.backup_codes.error_generate');
		} finally {
			isGenerating = false;
		}
	}

	function downloadCodes() {
		if (!newCodes.length) return;
		const content = [
			're/task — Backup Codes',
			`Generated: ${new Date().toLocaleString()}`,
			'',
			'Keep these codes in a safe place. Each code can only be used once.',
			'',
			...newCodes.map((code, i) => `${i + 1}. ${code}`)
		].join('\n');

		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'reborn-backup-codes.txt';
		a.click();
		URL.revokeObjectURL(url);
	}

	async function copyCode(code: string, index: number) {
		try {
			await navigator.clipboard.writeText(code);
			copiedIndex = index;
			setTimeout(() => (copiedIndex = null), 2000);
		} catch {
			// Clipboard not available
		}
	}

	async function copyAllCodes() {
		if (!newCodes.length) return;
		try {
			await navigator.clipboard.writeText(newCodes.join('\n'));
			toast.success($t('settings.security.backup_codes.copied'));
		} catch {
			// Clipboard not available
		}
	}

	onMount(() => {
		fetchStatus();
	});
</script>

<SettingsLayout title={$t('settings.security.backup_codes.title')} backHref="/settings">
	<div class="space-y-6">
		<!-- Info card -->
		<Alert>
			<ShieldCheck class="h-4 w-4" />
			<AlertDescription>
				{$t('settings.security.backup_codes.info')}
			</AlertDescription>
		</Alert>

		{#if error}
			<Alert variant="destructive">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		{/if}

		{#if isLoading}
			<Card>
				<CardContent class="pt-6">
					<div class="flex items-center justify-center py-8">
						<RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		{:else}
			<!-- Status card -->
			<Card>
				<CardHeader>
					<CardTitle class="text-base flex items-center gap-2">
						{#if status?.availableCount === 0 && status?.hasCodesGenerated}
							<ShieldAlert class="h-4 w-4 text-destructive" />
						{:else}
							<ShieldCheck class="h-4 w-4 text-muted-foreground" />
						{/if}
						{$t('settings.security.backup_codes.title')}
					</CardTitle>
					<CardDescription>
						{#if !status?.hasCodesGenerated}
							{$t('settings.security.backup_codes.status_not_generated')}
						{:else if status.availableCount === 0}
							{$t('settings.security.backup_codes.status_all_used')}
						{:else}
							{$t('settings.security.backup_codes.status_generated')
								.replace('{available}', String(status.availableCount))
								.replace('{total}', String(status.totalCount))}
						{/if}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !status?.hasCodesGenerated}
						<!-- No codes yet -->
						<Button onclick={generateCodes} disabled={isGenerating} class="w-full sm:w-auto">
							{isGenerating
								? $t('common.loading') || 'Generating...'
								: $t('settings.security.backup_codes.generate_button')}
						</Button>
					{:else if !showConfirmRegenerate}
						<!-- Has codes — show regenerate option -->
						<Button
							variant="outline"
							onclick={() => (showConfirmRegenerate = true)}
							disabled={isGenerating}
							class="w-full sm:w-auto"
						>
							<RefreshCw class="h-4 w-4 mr-2" />
							{$t('settings.security.backup_codes.regenerate_button')}
						</Button>
					{:else}
						<!-- Confirm regenerate -->
						<Alert variant="destructive">
							<AlertTriangle class="h-4 w-4" />
							<AlertDescription>
								{$t('settings.security.backup_codes.regenerate_warning')}
							</AlertDescription>
						</Alert>
						<div class="flex gap-2 flex-wrap">
							<Button variant="destructive" onclick={generateCodes} disabled={isGenerating}>
								{isGenerating
									? $t('common.loading') || 'Generating...'
									: $t('settings.security.backup_codes.regenerate_confirm')}
							</Button>
							<Button
								variant="outline"
								onclick={() => (showConfirmRegenerate = false)}
								disabled={isGenerating}
							>
								{$t('common.cancel') || 'Cancel'}
							</Button>
						</div>
					{/if}
				</CardContent>
			</Card>

			<!-- New codes (shown once after generation) -->
			{#if newCodes.length > 0}
				<Card class="border-primary/50">
					<CardHeader>
						<CardTitle class="text-base text-primary">
							{$t('settings.security.backup_codes.one_time_warning')}
						</CardTitle>
						<CardDescription>
							{$t('settings.security.backup_codes.generated_success').replace(
								'{count}',
								String(newCodes.length)
							)}
						</CardDescription>
					</CardHeader>
					<CardContent class="space-y-4">
						<!-- Code grid -->
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
							{#each newCodes as code, i}
								<div
									class="flex items-center justify-between font-mono text-sm bg-muted px-3 py-2 rounded border"
								>
									<span class="tracking-widest">{code}</span>
									<button
										onclick={() => copyCode(code, i)}
										class="ml-2 text-muted-foreground hover:text-foreground transition-colors"
										aria-label="Copy code"
									>
										{#if copiedIndex === i}
											<Check class="h-4 w-4 text-green-500" />
										{:else}
											<Copy class="h-4 w-4" />
										{/if}
									</button>
								</div>
							{/each}
						</div>

						<Separator />

						<div class="flex gap-2 flex-wrap">
							<Button onclick={downloadCodes} variant="outline">
								<Download class="h-4 w-4 mr-2" />
								{$t('settings.security.backup_codes.download_button')}
							</Button>
							<Button onclick={copyAllCodes} variant="outline">
								<Copy class="h-4 w-4 mr-2" />
								{$t('settings.security.backup_codes.copy_all')}
							</Button>
						</div>
					</CardContent>
				</Card>
			{/if}
		{/if}
	</div>
</SettingsLayout>
