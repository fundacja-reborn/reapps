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
	import { FileDown, FileUp, AlertTriangle, Info } from '@lucide/svelte';
	import { t } from '$lib/stores/i18n.store';
	import { toast } from '@reborn/ui';
	import { createLogger } from '@reborn/utils';
	import { dataExportService } from '$lib/services/data-export.service';
	import { dataImportService } from '$lib/services/data-import.service';

	const logger = createLogger('ImportExportPage');

	// Export state
	let isExportingDecrypted = $state(false);
	let isExportingEncrypted = $state(false);
	let showDecryptedWarning = $state(false);

	// Import state
	let importFile = $state<File | null>(null);
	let isImporting = $state(false);
	let importResult = $state<{ lists: number; tasks: number; subtasks: number; skipped: number; errors: string[] } | null>(null);
	let importError = $state<string | null>(null);

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

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		importFile = input.files?.[0] ?? null;
		importResult = null;
		importError = null;
	}

	async function handleImport() {
		if (!importFile) return;

		const MAX_SIZE = 50 * 1024 * 1024;
		if (importFile.size > MAX_SIZE) {
			importError = `Plik (${Math.round(importFile.size / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_SIZE / 1024 / 1024)} MB.`;
			return;
		}

		isImporting = true;
		importResult = null;
		importError = null;
		try {
			const result = await dataImportService.importFromFile(importFile);
			importResult = {
				lists: result.listsImported,
				tasks: result.tasksImported,
				subtasks: result.subtasksImported,
				skipped: result.skipped,
				errors: result.errors
			};
			toast.success(
				$t('settings.import_export.import_success', {
					lists: result.listsImported,
					tasks: result.tasksImported,
					subtasks: result.subtasksImported,
					default: `Import zakończony: ${result.listsImported} list, ${result.tasksImported} zadań, ${result.subtasksImported} podzadań`
				})
			);
			// Reset file input
			importFile = null;
			if (fileInput) fileInput.value = '';
		} catch (err: unknown) {
			logger.error('Import failed:', err);
			importError = err instanceof Error ? err.message : $t('settings.import_export.import_error');
		} finally {
			isImporting = false;
		}
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
						disabled={isExportingDecrypted || isExportingEncrypted}
						class="shrink-0"
					>
						{#if isExportingDecrypted}
							{$t('common.loading') || 'Eksportowanie...'}
						{:else}
							{$t('settings.import_export.export_decrypted_button')}
						{/if}
					</Button>
				</div>

				{#if showDecryptedWarning}
					<div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
						<AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
						<div class="text-xs text-amber-700 dark:text-amber-400">
							<p class="font-medium">Uwaga: dane zostaną wyeksportowane bez szyfrowania.</p>
							<p class="mt-1">Plik będzie zawierał wszystkie dane w czytelnej formie. Nie przechowuj go w niezabezpieczonych lokalizacjach.</p>
							<div class="mt-2 flex gap-2">
								<Button
									variant="destructive"
									size="sm"
									onclick={handleExportDecrypted}
									disabled={isExportingDecrypted}
								>
									{isExportingDecrypted ? 'Eksportowanie...' : 'Eksportuj mimo to'}
								</Button>
								<Button
									variant="outline"
									size="sm"
									onclick={() => showDecryptedWarning = false}
								>
									Anuluj
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
						disabled={isExportingDecrypted || isExportingEncrypted}
						class="shrink-0"
					>
						{#if isExportingEncrypted}
							{$t('common.loading') || 'Eksportowanie...'}
						{:else}
							{$t('settings.import_export.export_encrypted_button')}
						{/if}
					</Button>
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
								lists: importResult.lists,
								tasks: importResult.tasks,
								subtasks: importResult.subtasks,
								default: `Import zakończony: ${importResult.lists} list, ${importResult.tasks} zadań, ${importResult.subtasks} podzadań`
							})}
							{#if importResult.skipped > 0}
								<p class="mt-1 text-xs text-muted-foreground">
									Pominięto {importResult.skipped} elementów (nowsze lokalne wersje).
								</p>
							{/if}
						</AlertDescription>
					</Alert>
					{#if importResult.errors && importResult.errors.length > 0}
						<div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
							<AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
							<div class="text-xs text-amber-700 dark:text-amber-400">
								<p class="font-medium">Błędy podczas importu ({importResult.errors.length}):</p>
								<ul class="mt-1 list-disc list-inside space-y-0.5">
									{#each importResult.errors.slice(0, 10) as error}
										<li>{error}</li>
									{/each}
									{#if importResult.errors.length > 10}
										<li>...i {importResult.errors.length - 10} więcej</li>
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
						disabled={!importFile || isImporting}
						class="shrink-0"
					>
						{#if isImporting}
							{$t('common.loading') || 'Importowanie...'}
						{:else}
							{$t('settings.import_export.import_button')}
						{/if}
					</Button>
				</div>

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
