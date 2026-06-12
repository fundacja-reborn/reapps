<script lang="ts">
  import {
    SettingsLayout,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    LoadingSpinner,
    Progress
  } from '@reborn/ui';
  import {
    Download,
    Upload,
    FolderArchive,
    FolderInput,
    FolderSync,
    FileJson,
    FileText,
    KeyRound,
    Eye,
    EyeOff,
    AlertTriangle,
    ChevronRight
  } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { t } from '$lib/stores/i18n.store';
  import { foldersStore } from '$lib/stores/folders.store';
  import { tagsStore } from '$lib/stores/tags.store';
  import { getAllNotes } from '$lib/services/note.service';
  import {
    exportNotesAsZip,
    exportJsonBackup,
    exportEncryptedBackup,
    importMarkdownFiles,
    importFolder,
    importJsonBackup,
    isEncryptedBackup,
    type ImportBackupResult,
    type ImportFolderResult,
    type ImportMarkdownResult,
    type ImportProgress
  } from '$lib/services/export-import.service';
  import type { DuplicateStrategy } from '$lib/services/import-dedup-utils';
  import {
    countImportableMarkdownFiles,
    getRootFolderName
  } from '$lib/services/markdown-import-utils';
  import { notesStore } from '$lib/stores/notes.store';
  import MarkdownImportStrategyPicker from '$lib/components/import/MarkdownImportStrategyPicker.svelte';
  import ImportResultSummary from '$lib/components/import/ImportResultSummary.svelte';
  import { createLogger } from '@reborn/utils';

  const logger = createLogger('notes:import-export');

  // ── Export state ─────────────────────────────────────────────────
  // Tracks which export is currently running so we can show a spinner under
  // the matching section (instead of a single boolean that would either show
  // three spinners or none of them).
  type ExportKind = 'zip' | 'backup' | 'encrypted';
  let exportingKind = $state<ExportKind | null>(null);
  const exporting = $derived(exportingKind !== null);

  // Export encrypted backup
  let showExportPasswordForm = $state(false);
  let exportPassword = $state('');
  let exportPasswordVisible = $state(false);
  let exportError = $state<string | null>(null);

  // ── Import state ─────────────────────────────────────────────────
  let importing = $state(false);
  let importResult = $state<ImportMarkdownResult | null>(null);
  let importInputEl = $state<HTMLInputElement | null>(null);
  let backupImportInputEl = $state<HTMLInputElement | null>(null);

  // Pending file selection awaiting a duplicate-strategy choice.
  // Same shape for both single-file and folder imports — UI shows a strategy
  // picker with file count, then runs the import with the chosen strategy.
  let pendingMdFiles = $state<File[] | null>(null);
  let pendingMdStrategy = $state<DuplicateStrategy>('rename');
  // Live progress reported by the importer service. Mirrors `pendingMdFiles`
  // lifecycle: set when the import starts, cleared when it finishes.
  let mdProgress = $state<ImportProgress | null>(null);

  // Import folder (Obsidian-style vault)
  let importingFolder = $state(false);
  let folderImportResult = $state<ImportFolderResult | null>(null);
  let folderImportInputEl = $state<HTMLInputElement | null>(null);
  let pendingFolderFiles = $state<File[] | null>(null);
  let pendingFolderStrategy = $state<DuplicateStrategy>('rename');
  // Overwrite-only option: merge frontmatter tags into the note's existing
  // tags instead of replacing them, so tags added in the app survive
  // re-imports. Default ON - silent tag loss is the worse failure mode.
  let pendingFolderPreserveTags = $state(true);
  let pendingFolderMdCount = $state(0);
  // Name of the directory the user picked (first webkitRelativePath segment)
  // + whether to recreate it as the top-level folder. Default ON: "I picked
  // folder X, I get folder X" - and re-imports of the same directory then
  // refresh that folder in place instead of scattering content at the root.
  let pendingFolderRootName = $state<string | null>(null);
  let pendingFolderKeepRoot = $state(true);
  let folderProgress = $state<ImportProgress | null>(null);
  const folderImportDestination = $derived(
    pendingFolderKeepRoot && pendingFolderRootName !== null
      ? pendingFolderRootName
      : $t('nav.all_notes')
  );

  // Import JSON backup
  let importingBackup = $state(false);
  let backupImportResult = $state<ImportBackupResult | null>(null);
  let backupFileContent = $state<string | null>(null);
  let backupFileName = $state('');
  let backupNeedsPassword = $state(false);
  let backupPassword = $state('');
  let backupPasswordVisible = $state(false);
  let backupError = $state<string | null>(null);
  let backupProgress = $state<ImportProgress | null>(null);

  // ── Export handlers ──────────────────────────────────────────────

  async function handleExportAllZip() {
    exportingKind = 'zip';
    try {
      const allNotes = await getAllNotes();
      await exportNotesAsZip(allNotes, $foldersStore, 'reborn-notes-export');
    } catch (e: unknown) {
      logger.error('Export failed:', e);
    } finally {
      exportingKind = null;
    }
  }

  async function handleExportBackup() {
    exportingKind = 'backup';
    try {
      await exportJsonBackup();
    } catch (e: unknown) {
      logger.error('Backup export failed:', e);
    } finally {
      exportingKind = null;
    }
  }

  async function handleExportEncrypted(e: Event) {
    e.preventDefault();
    if (!exportPassword) return;
    if (exportPassword.length < 8) {
      exportError = $t('settings_page.export_import.password_too_short') || 'Hasło musi mieć minimum 8 znaków.';
      return;
    }
    exportingKind = 'encrypted';
    exportError = null;
    try {
      await exportEncryptedBackup(exportPassword);
      showExportPasswordForm = false;
      exportPassword = '';
    } catch (err: unknown) {
      exportError = err instanceof Error ? err.message : 'Export failed';
    } finally {
      exportingKind = null;
    }
  }

  // ── Import handlers ──────────────────────────────────────────────

  function triggerImport() {
    importResult = null;
    pendingMdFiles = null;
    pendingMdStrategy = 'rename';
    importInputEl?.click();
  }

  function handleImportFilesSelected(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (importInputEl) importInputEl.value = '';
    if (files.length === 0) return;
    // Show strategy picker before kicking off the import.
    pendingMdFiles = files;
  }

  function cancelMdImport() {
    pendingMdFiles = null;
  }

  async function runMdImport() {
    if (!pendingMdFiles) return;
    const files = pendingMdFiles;
    const strategy = pendingMdStrategy;
    pendingMdFiles = null;

    importing = true;
    importResult = null;
    mdProgress = { phase: 'reading', current: 0, total: files.length };
    try {
      const result = await importMarkdownFiles(files, undefined, strategy, (p) => {
        mdProgress = p;
      });
      importResult = result;
      await Promise.all([notesStore.refresh(), foldersStore.refresh()]);
    } catch (err: unknown) {
      importResult = {
        imported: 0,
        duplicatesSkipped: 0,
        duplicatesOverwritten: 0,
        duplicatesRenamed: 0,
        duplicatesUnchanged: 0,
        strippedCount: 0,
        errors: [err instanceof Error ? err.message : 'Import failed']
      };
    } finally {
      importing = false;
      mdProgress = null;
    }
  }

  // ── Folder import handlers ────────────────────────────────────────

  function triggerFolderImport() {
    folderImportResult = null;
    pendingFolderFiles = null;
    pendingFolderStrategy = 'rename';
    pendingFolderPreserveTags = true;
    pendingFolderMdCount = 0;
    pendingFolderRootName = null;
    pendingFolderKeepRoot = true;
    folderImportInputEl?.click();
  }

  function handleFolderFilesSelected(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (folderImportInputEl) folderImportInputEl.value = '';
    if (files.length === 0) return;
    pendingFolderFiles = files;
    pendingFolderMdCount = countImportableMarkdownFiles(files);
    pendingFolderRootName = getRootFolderName(files);
  }

  function cancelFolderImport() {
    pendingFolderFiles = null;
    pendingFolderMdCount = 0;
    pendingFolderRootName = null;
  }

  async function runFolderImport() {
    if (!pendingFolderFiles) return;
    const files = pendingFolderFiles;
    const strategy = pendingFolderStrategy;
    const keepRootFolder = pendingFolderKeepRoot && pendingFolderRootName !== null;
    const tagsOnOverwrite = pendingFolderPreserveTags ? ('merge' as const) : ('replace' as const);
    const initialMdCount = pendingFolderMdCount;
    pendingFolderFiles = null;
    pendingFolderMdCount = 0;
    pendingFolderRootName = null;

    importingFolder = true;
    folderImportResult = null;
    // Seed with the pre-filter count so the progress bar appears immediately;
    // the importer re-applies its own filters and reports `total` precisely.
    folderProgress = { phase: 'reading', current: 0, total: initialMdCount };
    try {
      const result = await importFolder(
        files,
        strategy,
        (p) => {
          folderProgress = p;
        },
        { keepRootFolder, tagsOnOverwrite }
      );
      folderImportResult = result;
      await Promise.all([
        notesStore.refresh(),
        foldersStore.refresh(),
        tagsStore.refresh()
      ]);
    } catch (err: unknown) {
      folderImportResult = {
        imported: 0,
        foldersCreated: 0,
        tagsCreated: 0,
        skippedNonMarkdown: 0,
        skippedTooLarge: 0,
        skippedHidden: 0,
        duplicatesSkipped: 0,
        duplicatesOverwritten: 0,
        duplicatesRenamed: 0,
        duplicatesUnchanged: 0,
        strippedCount: 0,
        errors: [err instanceof Error ? err.message : 'Import failed']
      };
    } finally {
      importingFolder = false;
      folderProgress = null;
    }
  }

  // ── Backup import handlers ────────────────────────────────────────

  function triggerBackupImport() {
    backupImportResult = null;
    backupError = null;
    backupFileContent = null;
    backupNeedsPassword = false;
    backupPassword = '';
    backupImportInputEl?.click();
  }

  async function handleBackupFileSelected(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      backupError = `Plik (${Math.round(file.size / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_SIZE / 1024 / 1024)} MB.`;
      if (backupImportInputEl) backupImportInputEl.value = '';
      return;
    }

    backupFileName = file.name;
    const raw = await file.text();
    backupFileContent = raw;
    if (backupImportInputEl) backupImportInputEl.value = '';

    if (isEncryptedBackup(raw)) {
      backupNeedsPassword = true;
    } else {
      await doBackupImport(raw);
    }
  }

  async function handleBackupPasswordSubmit(e: Event) {
    e.preventDefault();
    if (!backupFileContent || !backupPassword) return;
    await doBackupImport(backupFileContent, backupPassword);
  }

  async function doBackupImport(raw: string, password?: string) {
    importingBackup = true;
    backupError = null;
    backupImportResult = null;
    backupProgress = null;
    try {
      const result = await importJsonBackup(raw, password, (p) => {
        backupProgress = p;
      });
      backupImportResult = result;
      backupNeedsPassword = false;
      backupFileContent = null;
      backupPassword = '';
      await Promise.all([
        notesStore.refresh(),
        foldersStore.refresh(),
        tagsStore.refresh()
      ]);
    } catch (err: unknown) {
      backupError = err instanceof Error ? err.message : 'Import failed';
    } finally {
      importingBackup = false;
      backupProgress = null;
    }
  }

  function cancelBackupImport() {
    backupNeedsPassword = false;
    backupFileContent = null;
    backupPassword = '';
    backupError = null;
  }
</script>

<svelte:head>
  <title>{$t('settings_page.export_import.title')} — re/notes</title>
</svelte:head>

<SettingsLayout title={$t('settings_page.export_import.title')} backHref="/settings">
  <div class="space-y-6 px-4 sm:px-0">
    <!-- Export section -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Download class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.export_import.hub_export_desc')}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Export all notes as ZIP -->
        <div class="p-4 rounded-lg border bg-muted/30">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <FolderArchive class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{$t('settings_page.export_import.export_all')}</p>
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.export_all_desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onclick={handleExportAllZip}
              disabled={exporting}
              class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Download class="h-3.5 w-3.5" />
              {exportingKind === 'zip'
                ? $t('settings_page.export_import.exporting')
                : $t('settings_page.export_import.export_zip')}
            </button>
          </div>
          {#if exportingKind === 'zip'}
            <div
              class="mt-3 flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <LoadingSpinner size="sm" />
              <span>{$t('settings_page.export_import.export_status_zip')}</span>
            </div>
          {/if}
        </div>

        <!-- Export backup (account-encrypted JSON) -->
        <div class="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <FileJson class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{$t('settings_page.export_import.export_backup')}</p>
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.export_backup_desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onclick={handleExportBackup}
              disabled={exporting}
              class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Download class="h-3.5 w-3.5" />
              {exportingKind === 'backup'
                ? $t('settings_page.export_import.exporting')
                : $t('settings_page.export_import.export_json')}
            </button>
          </div>
          <div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
            <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p class="text-xs text-amber-700 dark:text-amber-400">
              {$t('settings_page.export_import.export_backup_warning')}
            </p>
          </div>
          {#if exportingKind === 'backup'}
            <div
              class="flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <LoadingSpinner size="sm" />
              <span>{$t('settings_page.export_import.export_status_backup')}</span>
            </div>
          {/if}
        </div>

        <!-- Export encrypted backup (password-protected, portable) -->
        <div class="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <KeyRound class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">
                  {$t('settings_page.export_import.export_encrypted')}
                </p>
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.export_encrypted_desc')}
                </p>
              </div>
            </div>
            {#if !showExportPasswordForm}
              <button
                type="button"
                onclick={() => {
                  showExportPasswordForm = true;
                  exportError = null;
                }}
                disabled={exporting}
                class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
              >
                <Download class="h-3.5 w-3.5" />
                {$t('settings_page.export_import.export_btn')}
              </button>
            {/if}
          </div>
          <div class="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
            <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p class="text-xs text-amber-700 dark:text-amber-400">
              {$t('settings_page.export_import.export_encrypted_warning')}
            </p>
          </div>
          {#if showExportPasswordForm}
            <form onsubmit={handleExportEncrypted} class="mt-3 space-y-2">
              <div class="relative">
                <input
                  type={exportPasswordVisible ? 'text' : 'password'}
                  bind:value={exportPassword}
                  placeholder={$t('settings_page.export_import.password_placeholder')}
                  disabled={exporting}
                  class="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <button
                  type="button"
                  onclick={() => (exportPasswordVisible = !exportPasswordVisible)}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabindex={-1}
                >
                  {#if exportPasswordVisible}
                    <EyeOff class="h-4 w-4" />
                  {:else}
                    <Eye class="h-4 w-4" />
                  {/if}
                </button>
              </div>
              {#if exportError}
                <p class="text-xs text-destructive">{exportError}</p>
              {/if}
              <div class="flex gap-2">
                <button
                  type="submit"
                  disabled={exporting || !exportPassword}
                  class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Download class="h-3.5 w-3.5" />
                  {exportingKind === 'encrypted'
                    ? $t('settings_page.export_import.encrypting')
                    : $t('settings_page.export_import.export_encrypted_btn')}
                </button>
                <button
                  type="button"
                  onclick={() => {
                    showExportPasswordForm = false;
                    exportPassword = '';
                    exportError = null;
                  }}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  {$t('settings_page.export_import.cancel')}
                </button>
              </div>
            </form>
            {#if exportingKind === 'encrypted'}
              <div
                class="flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <LoadingSpinner size="sm" />
                <span>{$t('settings_page.export_import.export_status_encrypted')}</span>
              </div>
            {/if}
          {/if}
        </div>
      </CardContent>
    </Card>

    <!-- Import section -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Upload class="h-4 w-4 text-muted-foreground" />
          {$t('settings_page.export_import.hub_import_desc')}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Import from Markdown -->
        <div class="p-4 rounded-lg border bg-muted/30">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">
                  {$t('settings_page.export_import.import_markdown')}
                </p>
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.import_markdown_desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onclick={triggerImport}
              disabled={importing || pendingMdFiles !== null}
              class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Upload class="h-3.5 w-3.5" />
              {importing
                ? $t('settings_page.export_import.importing')
                : $t('settings_page.export_import.import_md')}
            </button>
          </div>

          {#if pendingMdFiles}
            <div class="mt-3 space-y-3 rounded-md border border-primary/40 bg-background p-3">
              <MarkdownImportStrategyPicker
                count={pendingMdFiles.length}
                bind:strategy={pendingMdStrategy}
                promptVariant="root"
                radioGroupName="md-strategy"
              />
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={runMdImport}
                  disabled={importing}
                  class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Upload class="h-3.5 w-3.5" />
                  {$t('settings_page.export_import.dedup_start')}
                </button>
                <button
                  type="button"
                  onclick={cancelMdImport}
                  disabled={importing}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {$t('settings_page.export_import.cancel')}
                </button>
              </div>
            </div>
          {/if}

          {#if importing}
            <div
              class="mt-3 rounded-md border bg-muted/40 px-3 py-2.5 text-xs space-y-2"
              role="status"
              aria-live="polite"
            >
              <div class="flex items-center gap-2 text-muted-foreground">
                <LoadingSpinner size="sm" />
                <span>
                  {#if mdProgress?.phase === 'indexing'}
                    {$t('settings_page.export_import.import_status_indexing')}
                  {:else if mdProgress && mdProgress.total > 0}
                    {$t('settings_page.export_import.import_status_reading', {
                      values: { current: mdProgress.current, total: mdProgress.total }
                    })}
                  {:else}
                    {$t('settings_page.export_import.import_status_starting')}
                  {/if}
                </span>
              </div>
              {#if mdProgress?.phase === 'reading' && mdProgress.total > 1}
                <Progress value={mdProgress.current} max={mdProgress.total} class="h-1.5" />
              {/if}
            </div>
          {/if}

          {#if importResult}
            <ImportResultSummary result={importResult} class="mt-3" />
          {/if}
        </div>

        <!-- Import folder (Obsidian-style vault) -->
        <div class="p-4 rounded-lg border bg-muted/30">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <FolderInput class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">
                  {$t('settings_page.export_import.import_folder')}
                </p>
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.import_folder_desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onclick={triggerFolderImport}
              disabled={importingFolder || pendingFolderFiles !== null}
              class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              <FolderInput class="h-3.5 w-3.5" />
              {importingFolder
                ? $t('settings_page.export_import.importing_folder')
                : $t('settings_page.export_import.import_folder_btn')}
            </button>
          </div>

          {#if pendingFolderFiles}
            <div class="mt-3 space-y-3 rounded-md border border-primary/40 bg-background p-3">
              <MarkdownImportStrategyPicker
                count={pendingFolderMdCount}
                bind:strategy={pendingFolderStrategy}
                promptVariant="folder"
                radioGroupName="folder-strategy"
                showPreserveTags={true}
                bind:preserveTags={pendingFolderPreserveTags}
              />
              {#if pendingFolderRootName !== null}
                <label class="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" bind:checked={pendingFolderKeepRoot} class="mt-0.5" />
                  <span>
                    <span class="font-medium">
                      {$t('settings_page.export_import.keep_root_label', {
                        values: { name: pendingFolderRootName }
                      })}
                    </span>
                    <span class="block text-muted-foreground">
                      {$t('settings_page.export_import.keep_root_destination', {
                        values: { path: folderImportDestination }
                      })}
                    </span>
                  </span>
                </label>
              {/if}
              <div class="flex gap-2">
                <button
                  type="button"
                  onclick={runFolderImport}
                  disabled={importingFolder || pendingFolderMdCount === 0}
                  class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <FolderInput class="h-3.5 w-3.5" />
                  {$t('settings_page.export_import.dedup_start')}
                </button>
                <button
                  type="button"
                  onclick={cancelFolderImport}
                  disabled={importingFolder}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {$t('settings_page.export_import.cancel')}
                </button>
              </div>
            </div>
          {/if}

          {#if importingFolder}
            <div
              class="mt-3 rounded-md border bg-muted/40 px-3 py-2.5 text-xs space-y-2"
              role="status"
              aria-live="polite"
            >
              <div class="flex items-center gap-2 text-muted-foreground">
                <LoadingSpinner size="sm" />
                <span>
                  {#if folderProgress?.phase === 'indexing'}
                    {$t('settings_page.export_import.import_status_indexing')}
                  {:else if folderProgress && folderProgress.total > 0}
                    {$t('settings_page.export_import.import_status_reading', {
                      values: { current: folderProgress.current, total: folderProgress.total }
                    })}
                  {:else}
                    {$t('settings_page.export_import.import_status_starting')}
                  {/if}
                </span>
              </div>
              {#if folderProgress?.phase === 'reading' && folderProgress.total > 1}
                <Progress value={folderProgress.current} max={folderProgress.total} class="h-1.5" />
              {/if}
            </div>
          {/if}

          {#if folderImportResult}
            <ImportResultSummary result={folderImportResult} class="mt-3" />
          {/if}
        </div>

        <!-- Live folder sync moved to its own settings page (multi-folder) -->
        <a
          href={resolve('/settings/folder-sync')}
          class="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 transition-colors hover:bg-accent/50"
        >
          <FolderSync class="h-4 w-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">
              {$t('settings_page.export_import.folder_sync_title')}
            </p>
            <p class="text-xs text-muted-foreground">
              {$t('settings_page.export_import.folder_sync_hub_desc')}
            </p>
          </div>
          <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
        </a>

        <!-- Import JSON backup -->
        <div class="p-4 rounded-lg border bg-muted/30">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <FileJson class="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p class="text-sm font-medium">{$t('settings_page.export_import.import_backup')}</p>
                <p class="text-xs text-muted-foreground">
                  {$t('settings_page.export_import.import_backup_desc')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onclick={triggerBackupImport}
              disabled={importingBackup}
              class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Upload class="h-3.5 w-3.5" />
              {importingBackup
                ? $t('settings_page.export_import.importing')
                : $t('settings_page.export_import.import_json')}
            </button>
          </div>

          <!-- Password prompt for encrypted backup -->
          {#if backupNeedsPassword}
            <form onsubmit={handleBackupPasswordSubmit} class="mt-3 space-y-2">
              <p class="text-xs text-muted-foreground">
                {$t('settings_page.export_import.encrypted_prompt', {
                  values: { name: backupFileName }
                })}
              </p>
              <div class="relative">
                <input
                  type={backupPasswordVisible ? 'text' : 'password'}
                  bind:value={backupPassword}
                  placeholder={$t('settings_page.export_import.backup_password')}
                  disabled={importingBackup}
                  class="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <button
                  type="button"
                  onclick={() => (backupPasswordVisible = !backupPasswordVisible)}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabindex={-1}
                >
                  {#if backupPasswordVisible}
                    <EyeOff class="h-4 w-4" />
                  {:else}
                    <Eye class="h-4 w-4" />
                  {/if}
                </button>
              </div>
              {#if backupError}
                <p class="text-xs text-destructive">{backupError}</p>
              {/if}
              <div class="flex gap-2">
                <button
                  type="submit"
                  disabled={importingBackup || !backupPassword}
                  class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <Upload class="h-3.5 w-3.5" />
                  {importingBackup
                    ? $t('settings_page.export_import.decrypting')
                    : $t('settings_page.export_import.decrypt_import')}
                </button>
                <button
                  type="button"
                  onclick={cancelBackupImport}
                  class="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  {$t('settings_page.export_import.cancel')}
                </button>
              </div>
            </form>
          {/if}

          {#if backupError && !backupNeedsPassword}
            <div
              class="mt-3 rounded-md px-3 py-2 text-xs bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            >
              <p>{backupError}</p>
            </div>
          {/if}

          {#if importingBackup}
            <div
              class="mt-3 rounded-md border bg-muted/40 px-3 py-2.5 text-xs space-y-2"
              role="status"
              aria-live="polite"
            >
              <div class="flex items-center gap-2 text-muted-foreground">
                <LoadingSpinner size="sm" />
                <span>
                  {#if backupProgress?.phase === 'indexing'}
                    {$t('settings_page.export_import.import_status_indexing')}
                  {:else if backupProgress && backupProgress.total > 0}
                    {$t('settings_page.export_import.import_status_reading', {
                      values: { current: backupProgress.current, total: backupProgress.total }
                    })}
                  {:else}
                    {$t('settings_page.export_import.import_backup_status')}
                  {/if}
                </span>
              </div>
              {#if backupProgress?.phase === 'reading' && backupProgress.total > 1}
                <Progress value={backupProgress.current} max={backupProgress.total} class="h-1.5" />
              {/if}
            </div>
          {/if}

          {#if backupImportResult}
            <div
              class="mt-3 rounded-md px-3 py-2 text-xs
              {backupImportResult.errors.length === 0
                ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'}"
            >
              {#if backupImportResult.notes > 0 || backupImportResult.folders > 0 || backupImportResult.tags > 0}
                <p>
                  {$t('settings_page.export_import.imported_summary', {
                    values: {
                      notes: backupImportResult.notes,
                      folders: backupImportResult.folders,
                      tags: backupImportResult.tags
                    }
                  })}
                </p>
              {/if}
              {#if backupImportResult.restoredFromTrash > 0}
                <p>
                  {$t('settings_page.export_import.restored_from_trash', {
                    values: { count: backupImportResult.restoredFromTrash }
                  })}
                </p>
              {/if}
              {#if backupImportResult.relinkedToFolder > 0}
                <p>
                  {$t('settings_page.export_import.relinked_to_folder', {
                    values: { count: backupImportResult.relinkedToFolder }
                  })}
                </p>
              {/if}
              {#if backupImportResult.skipped > 0}
                <p class="text-muted-foreground">
                  Pominięto {backupImportResult.skipped} elementów (nowsze lokalne wersje).
                </p>
              {/if}
              {#if backupImportResult.strippedCount > 0}
                <p>
                  {$t('settings_page.export_import.unsafe_content_stripped', {
                    values: { count: backupImportResult.strippedCount }
                  })}
                </p>
              {/if}
              {#each backupImportResult.errors as err}
                <p>{err}</p>
              {/each}
            </div>
          {/if}
        </div>
      </CardContent>
    </Card>

    <!-- Hidden file inputs -->
    <input
      bind:this={importInputEl}
      type="file"
      accept=".md,text/markdown,text/plain"
      multiple
      class="hidden"
      onchange={handleImportFilesSelected}
      aria-hidden="true"
    />
    <input
      bind:this={folderImportInputEl}
      type="file"
      webkitdirectory
      multiple
      class="hidden"
      onchange={handleFolderFilesSelected}
      aria-hidden="true"
    />
    <input
      bind:this={backupImportInputEl}
      type="file"
      accept=".json,application/json"
      class="hidden"
      onchange={handleBackupFileSelected}
      aria-hidden="true"
    />
  </div>
</SettingsLayout>
