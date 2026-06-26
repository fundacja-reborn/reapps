<script lang="ts">
	import {
		SettingsLayout,
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
		Button,
		Alert,
		AlertDescription
	} from '@reborn/ui';
	import { FileDown, FileUp, AlertTriangle, Info, Eye, EyeOff } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { toast } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';
	import { dataExportService } from '$lib/services/data-export.service';
	import { dataImportService } from '$lib/services/data-import.service';

	const logger = createLogger('ImportExportPage');

	// Export state
	let isExportingDecrypted = $state(false);
	let isExportingEncrypted = $state(false);
	let isExportingPortable = $state(false);
	let showDecryptedWarning = $state(false);

	// Portable (password-protected) export
	let showPortableForm = $state(false);
	let portablePassword = $state('');
	let portablePasswordVisible = $state(false);
	let portableError = $state<string | null>(null);

	// Import state
	let importFile = $state<File | null>(null);
	let isImporting = $state(false);
	let importResult = $state<{ lists: number; tasks: number; subtasks: number; skipped: number; errors: string[] } | null>(null);
	let importError = $state<string | null>(null);

	// Password prompt for importing a portable (password-protected) backup
	let importNeedsPassword = $state(false);
	let importPassword = $state('');
	let importPasswordVisible = $state(false);

	let fileInput: HTMLInputElement;

	async function handleExportDecrypted() {
		if (!showDecryptedWarning) {
			showDecryptedWarning = true;
			return;
		}
		showDecryptedWarning = false;
		isExportingDecrypted = true;
		try {
			await dataExportService.exportDecrypted();
			toast.success($t('settings.import_export.export_success'));
		} catch (err: unknown) {
			logger.error('Export decrypted failed:', err);
			toast.error($t('settings.import_export.export_error'));
		} finally {
			isExportingDecrypted = false;
		}
	}

	async function handleExportEncrypted() {
		isExportingEncrypted = true;
		try {
			await dataExportService.exportEncrypted();
			toast.success($t('settings.import_export.export_success'));
		} catch (err: unknown) {
			logger.error('Export encrypted failed:', err);
			toast.error($t('settings.import_export.export_error'));
		} finally {
			isExportingEncrypted = false;
		}
	}

	async function handleExportPortable(e: Event) {
		e.preventDefault();
		if (!portablePassword) return;
		if (portablePassword.length < 8) {
			portableError = $t('settings.import_export.portable_password_too_short');
			return;
		}
		isExportingPortable = true;
		portableError = null;
		try {
			await dataExportService.exportEncryptedPortable(portablePassword);
			toast.success($t('settings.import_export.export_success'));
			showPortableForm = false;
			portablePassword = '';
		} catch (err: unknown) {
			logger.error('Export portable failed:', err);
			portableError = err instanceof Error ? err.message : $t('settings.import_export.export_error');
		} finally {
			isExportingPortable = false;
		}
	}

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		importFile = input.files?.[0] ?? null;
		importResult = null;
		importError = null;
		// A new file selection invalidates any pending password prompt.
		importNeedsPassword = false;
		importPassword = '';
	}

	async function handleImport() {
		if (!importFile) return;

		const MAX_SIZE = 50 * 1024 * 1024;
		if (importFile.size > MAX_SIZE) {
			importError = `Plik (${Math.round(importFile.size / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_SIZE / 1024 / 1024)} MB.`;
			return;
		}

		// Detect a portable (password-protected) backup and prompt for the
		// password before importing. Once the prompt is shown the form's submit
		// calls back into handleImport with importPassword set.
		if (!importNeedsPassword) {
			try {
				const text = await importFile.text();
				if (dataImportService.isPortableEncryptedText(text)) {
					importNeedsPassword = true;
					return;
				}
			} catch {
				// Fall through - importFromFile will surface a precise parse error.
			}
		}

		isImporting = true;
		importResult = null;
		importError = null;
		try {
			const result = await dataImportService.importFromFile(
				importFile,
				importPassword || undefined
			);
			importResult = {
				lists: result.listsImported,
				tasks: result.tasksImported,
				subtasks: result.subtasksImported,
				skipped: result.skipped,
				errors: result.errors
			};
			toast.success(
				$t('settings.import_export.import_success', {
					values: {
						lists: result.listsImported,
						tasks: result.tasksImported,
						subtasks: result.subtasksImported
					},
					default: `Import complete: ${result.listsImported} lists, ${result.tasksImported} tasks, ${result.subtasksImported} subtasks`
				})
			);
			// Reset file input
			importFile = null;
			importNeedsPassword = false;
			importPassword = '';
			if (fileInput) fileInput.value = '';
		} catch (err: unknown) {
			logger.error('Import failed:', err);
			importError = err instanceof Error ? err.message : $t('settings.import_export.import_error');
		} finally {
			isImporting = false;
		}
	}

	function cancelImportPassword() {
		importNeedsPassword = false;
		importPassword = '';
		importError = null;
	}
</script>

<SettingsLayout title={$t('settings.import_export.title')} backHref="/settings">
	<div class="space-y-6">
		<!-- Export section -->
		<Card>
			<CardHeader>
				<CardTitle class="text-base flex items-center gap-2">
					<FileDown class="h-4 w-4 text-muted-foreground" />
					{$t('settings.import_export.export_title')}
				</CardTitle>
				<CardDescription>{$t('settings.import_export.export_description')}</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<!-- Decrypted export -->
				<div class="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border bg-muted/30">
					<div class="flex-1 min-w-0">
						<div class="font-medium text-sm">{$t('settings.import_export.export_decrypted_title')}</div>
						<div class="text-sm text-muted-foreground mt-0.5">
							{$t('settings.import_export.export_decrypted_description')}
						</div>
					</div>
					<Button
						variant="outline"
						onclick={handleExportDecrypted}
						disabled={isExportingDecrypted || isExportingEncrypted || isExportingPortable}
						class="shrink-0"
					>
						{#if isExportingDecrypted}
							{$t('settings.import_export.exporting')}
						{:else}
							{$t('settings.import_export.export_decrypted_button')}
						{/if}
					</Button>
				</div>

				{#if showDecryptedWarning}
					<div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
						<AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
						<div class="text-xs text-amber-700 dark:text-amber-400">
							<p class="font-medium">{$t('settings.import_export.export_decrypted_warning_title')}</p>
							<p class="mt-1">{$t('settings.import_export.export_decrypted_warning_body')}</p>
							<div class="mt-2 flex gap-2">
								<Button
									variant="destructive"
									size="sm"
									onclick={handleExportDecrypted}
									disabled={isExportingDecrypted}
								>
									{isExportingDecrypted ? $t('settings.import_export.exporting') : $t('settings.import_export.export_anyway_button')}
								</Button>
								<Button
									variant="outline"
									size="sm"
									onclick={() => showDecryptedWarning = false}
								>
									{$t('common.cancel')}
								</Button>
							</div>
						</div>
					</div>
				{/if}

				<!-- Encrypted export -->
				<div class="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border bg-muted/30">
					<div class="flex-1 min-w-0">
						<div class="font-medium text-sm">{$t('settings.import_export.export_encrypted_title')}</div>
						<div class="text-sm text-muted-foreground mt-0.5">
							{$t('settings.import_export.export_encrypted_description')}
						</div>
					</div>
					<Button
						variant="outline"
						onclick={handleExportEncrypted}
						disabled={isExportingDecrypted || isExportingEncrypted || isExportingPortable}
						class="shrink-0"
					>
						{#if isExportingEncrypted}
							{$t('settings.import_export.exporting')}
						{:else}
							{$t('settings.import_export.export_encrypted_button')}
						{/if}
					</Button>
				</div>

				<!-- Portable encrypted export (password-protected, cross-account) -->
				<div class="flex flex-col gap-3 p-4 rounded-lg border bg-muted/30">
					<div class="flex flex-col sm:flex-row sm:items-center gap-3">
						<div class="flex-1 min-w-0">
							<div class="font-medium text-sm">
								{$t('settings.import_export.export_portable_title')}
							</div>
							<div class="text-sm text-muted-foreground mt-0.5">
								{$t('settings.import_export.export_portable_description')}
							</div>
						</div>
						{#if !showPortableForm}
							<Button
								variant="outline"
								onclick={() => {
									showPortableForm = true;
									portableError = null;
								}}
								disabled={isExportingDecrypted || isExportingEncrypted || isExportingPortable}
								class="shrink-0"
							>
								{$t('settings.import_export.export_portable_button')}
							</Button>
						{/if}
					</div>
					<div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
						<AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
						<p class="text-xs text-amber-700 dark:text-amber-400">
							{$t('settings.import_export.export_portable_warning')}
						</p>
					</div>
					{#if showPortableForm}
						<form onsubmit={handleExportPortable} class="space-y-2">
							<div class="relative">
								<input
									type={portablePasswordVisible ? 'text' : 'password'}
									bind:value={portablePassword}
									placeholder={$t('settings.import_export.portable_password_placeholder')}
									disabled={isExportingPortable}
									class="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
								/>
								<button
									type="button"
									onclick={() => (portablePasswordVisible = !portablePasswordVisible)}
									class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
									tabindex={-1}
								>
									{#if portablePasswordVisible}
										<EyeOff class="h-4 w-4" />
									{:else}
										<Eye class="h-4 w-4" />
									{/if}
								</button>
							</div>
							{#if portableError}
								<p class="text-xs text-destructive">{portableError}</p>
							{/if}
							<div class="flex gap-2">
								<Button type="submit" size="sm" disabled={isExportingPortable || !portablePassword}>
									{isExportingPortable
										? $t('settings.import_export.portable_encrypting')
										: $t('settings.import_export.portable_encrypt_button')}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => {
										showPortableForm = false;
										portablePassword = '';
										portableError = null;
									}}
								>
									{$t('common.cancel')}
								</Button>
							</div>
						</form>
					{/if}
				</div>
			</CardContent>
		</Card>

		<!-- Import section -->
		<Card>
			<CardHeader>
				<CardTitle class="text-base flex items-center gap-2">
					<FileUp class="h-4 w-4 text-muted-foreground" />
					{$t('settings.import_export.import_title')}
				</CardTitle>
				<CardDescription>
					{$t('settings.import_export.import_section_description')}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if importError}
					<Alert variant="destructive">
						<AlertDescription>{importError}</AlertDescription>
					</Alert>
				{/if}

				{#if importResult}
					<Alert>
						<AlertDescription>
							{$t('settings.import_export.import_success', {
								values: {
									lists: importResult.lists,
									tasks: importResult.tasks,
									subtasks: importResult.subtasks
								},
								default: `Import complete: ${importResult.lists} lists, ${importResult.tasks} tasks, ${importResult.subtasks} subtasks`
							})}
							{#if importResult.skipped > 0}
								<p class="mt-1 text-xs text-muted-foreground">
									{$t('settings.import_export.import_skipped_note', {
										values: { count: importResult.skipped },
										default: `Skipped ${importResult.skipped} items (newer local versions).`
									})}
								</p>
							{/if}
						</AlertDescription>
					</Alert>
					{#if importResult.errors && importResult.errors.length > 0}
						<div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
							<AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
							<div class="text-xs text-amber-700 dark:text-amber-400">
								<p class="font-medium">
									{$t('settings.import_export.import_errors_title', {
										values: { count: importResult.errors.length },
										default: `Import errors (${importResult.errors.length}):`
									})}
								</p>
								<ul class="mt-1 list-disc list-inside space-y-0.5">
									{#each importResult.errors.slice(0, 10) as error}
										<li>{error}</li>
									{/each}
									{#if importResult.errors.length > 10}
										<li>
											{$t('settings.import_export.import_errors_more', {
												values: { count: importResult.errors.length - 10 },
												default: `...and ${importResult.errors.length - 10} more`
											})}
										</li>
									{/if}
								</ul>
							</div>
						</div>
					{/if}
				{/if}

				<div class="flex flex-col sm:flex-row gap-3">
					<div class="flex-1">
						<input
							bind:this={fileInput}
							type="file"
							accept=".json"
							onchange={handleFileChange}
							class="block w-full text-sm text-muted-foreground
								file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-input
								file:text-sm file:font-medium file:bg-background file:text-foreground
								hover:file:bg-muted cursor-pointer"
						/>
					</div>
					<Button
						onclick={handleImport}
						disabled={!importFile || isImporting || importNeedsPassword}
						class="shrink-0"
					>
						{#if isImporting}
							{$t('settings.import_export.importing')}
						{:else}
							{$t('settings.import_export.import_button')}
						{/if}
					</Button>
				</div>

				<!-- Password prompt for a portable (password-protected) backup -->
				{#if importNeedsPassword}
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleImport();
						}}
						class="space-y-2 rounded-md border border-primary/40 p-3"
					>
						<p class="text-xs text-muted-foreground">
							{$t('settings.import_export.import_encrypted_prompt')}
						</p>
						<div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
							<AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
							<p class="text-xs text-amber-700 dark:text-amber-400">
								{$t('settings.import_export.import_portable_additive_note')}
							</p>
						</div>
						<div class="relative">
							<input
								type={importPasswordVisible ? 'text' : 'password'}
								bind:value={importPassword}
								placeholder={$t('settings.import_export.import_password_placeholder')}
								disabled={isImporting}
								class="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
							/>
							<button
								type="button"
								onclick={() => (importPasswordVisible = !importPasswordVisible)}
								class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								tabindex={-1}
							>
								{#if importPasswordVisible}
									<EyeOff class="h-4 w-4" />
								{:else}
									<Eye class="h-4 w-4" />
								{/if}
							</button>
						</div>
						<div class="flex gap-2">
							<Button type="submit" size="sm" disabled={isImporting || !importPassword}>
								{isImporting
									? $t('settings.import_export.import_decrypting')
									: $t('settings.import_export.import_decrypt_button')}
							</Button>
							<Button type="button" variant="outline" size="sm" onclick={cancelImportPassword}>
								{$t('common.cancel')}
							</Button>
						</div>
					</form>
				{/if}

				<!-- Info notes -->
				<div class="rounded-lg border bg-muted/30 p-4 space-y-2">
					<div class="flex items-center gap-2 text-sm font-medium">
						<Info class="h-4 w-4 text-muted-foreground" />
						{$t('settings.import_export.import_notes_title')}
					</div>
					<ul class="text-sm text-muted-foreground space-y-1 ml-6 list-disc">
						<li>{$t('settings.import_export.import_note_1')}</li>
						<li>{$t('settings.import_export.import_note_2')}</li>
						<li>{$t('settings.import_export.import_note_3')}</li>
					</ul>
				</div>
			</CardContent>
		</Card>
	</div>
</SettingsLayout>
