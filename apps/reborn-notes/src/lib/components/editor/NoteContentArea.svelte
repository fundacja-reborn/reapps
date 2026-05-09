<script lang="ts">
  import NoteEditor from '$lib/components/NoteEditor.svelte';
  import MarkdownPreview from '$lib/components/MarkdownPreview.svelte';
  import MarkdownDiffView from '$lib/components/MarkdownDiffView.svelte';
  import EncryptionXRay from '$lib/components/EncryptionXRay.svelte';
  import { noteDetailService } from '$lib/services/note-detail.service.svelte';
  import { t } from '$lib/stores/i18n.store';
  import type { ImageLoadMode, PeriodicKind } from '@reborn/storage';

  type ViewMode = 'edit' | 'split' | 'preview';

  let {
    noteId,
    effectiveViewMode,
    showEncryptionXRay = $bindable(false),
    historyMode,
    historyViewMode,
    selectedVersion,
    previousVersion,
    editorRef = $bindable(null),
    previewScrollEl = $bindable(null),
    previewContentEl = $bindable(null),
    autocompleteNotes,
    imageLoadMode = 'ask' as ImageLoadMode,
    noteKind = null,
    parentScroll = false,
    isMobile = false,
    oncontentchange,
    onviewinit,
    onviewdestroy,
    onpreviewrender,
    onnotelinkrequest,
    onnotelink,
    resolveNoteTitle
  }: {
    noteId: string;
    effectiveViewMode: ViewMode;
    showEncryptionXRay: boolean;
    historyMode: 'closed' | 'list' | 'diff';
    historyViewMode: 'preview' | 'diff';
    selectedVersion: import('@reborn/types').NoteHistoryDecrypted | null;
    previousVersion: import('@reborn/types').NoteHistoryDecrypted | null;
    editorRef: NoteEditor | null;
    previewScrollEl: HTMLElement | null;
    previewContentEl?: HTMLElement | null;
    autocompleteNotes: { id: string; title: string }[];
    imageLoadMode?: ImageLoadMode;
    /** Periodic kind of the open note (daily/weekly/monthly), or null for a regular
     *  note. Drives kind-aware editor placeholder copy. */
    noteKind?: PeriodicKind | null;
    /** When true (desktop edit mode), the parent scrolls and editor grows to content.
     *  Effective only in single-pane edit mode — split view always uses independent
     *  scrolls per pane. */
    parentScroll?: boolean;
    /** When true, the editor renders the mobile toolbar (sticky on top of editor). */
    isMobile?: boolean;
    oncontentchange: (content: string) => void;
    /** Forwarded from NoteEditor — fires when CM6 EditorView is created. */
    onviewinit?: (view: import('@codemirror/view').EditorView) => void;
    /** Forwarded from NoteEditor — fires before the EditorView is destroyed. */
    onviewdestroy?: () => void;
    /** Forwarded from MarkdownPreview — fires after each render commit. */
    onpreviewrender?: () => void;
    onnotelinkrequest: () => void;
    onnotelink: (noteId: string) => void;
    resolveNoteTitle: (noteId: string) => string | undefined;
  } = $props();

  // Split view always uses independent scrolls per pane — sticky+100dvh inside a
  // flex container caused reflow loops on iOS Safari. Edit and preview both let
  // the parent scroll (parent grows with content, sticky toolbar/header work).
  const isParentScrollActive = $derived(parentScroll && effectiveViewMode !== 'split');

  const placeholderText = $derived(
    noteKind ? $t(`notes.periodic.${noteKind}.placeholder`) : $t('editor.placeholder')
  );
</script>

<div class="relative {isParentScrollActive ? '' : 'flex min-h-0 flex-1 overflow-hidden'}">
  {#if showEncryptionXRay && historyMode === 'closed'}
    <EncryptionXRay
      {noteId}
      plainTitle={noteDetailService.title}
      plainContent={noteDetailService.content}
      onclose={() => {
        showEncryptionXRay = false;
      }}
    />
  {/if}

  {#if historyMode === 'diff' && selectedVersion}
    <!-- History content -->
    {#if historyViewMode === 'diff' && previousVersion}
      <MarkdownDiffView oldText={previousVersion.content} newText={selectedVersion.content} />
    {:else}
      <MarkdownPreview content={selectedVersion.content} class="flex-1 px-5" {imageLoadMode} />
    {/if}
  {:else}
    <!-- Normal editor content -->
    <main class={isParentScrollActive ? '' : 'min-h-0 flex-1 overflow-hidden'}>
      {#if effectiveViewMode === 'edit'}
        <NoteEditor
          bind:this={editorRef}
          content={noteDetailService.content}
          placeholder={placeholderText}
          onchange={oncontentchange}
          {onviewinit}
          {onviewdestroy}
          {onnotelinkrequest}
          onnotelinkclick={onnotelink}
          availableNotes={autocompleteNotes}
          currentNoteId={noteId}
          parentScroll={parentScroll}
          {isMobile}
          {imageLoadMode}
        />
      {:else if effectiveViewMode === 'split'}
        <!-- Split: each pane owns its scroll; sync handled by scroll-sync.ts.
             Avoids sticky+100dvh reflow loop that caused auto-scroll-to-top on iOS. -->
        <div class="flex divide-x divide-border h-full min-h-0">
          <div class="min-w-0 flex-1 overflow-hidden">
            <NoteEditor
              bind:this={editorRef}
              content={noteDetailService.content}
              placeholder={placeholderText}
              onchange={oncontentchange}
              {onviewinit}
              {onviewdestroy}
              {onnotelinkrequest}
              availableNotes={autocompleteNotes}
              currentNoteId={noteId}
              parentScroll={false}
              splitView
              {isMobile}
              {imageLoadMode}
            />
          </div>
          <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div class="flex shrink-0 items-center border-b bg-background/95 backdrop-blur-sm px-4 py-1.5">
              <span class="flex h-7 items-center text-xs font-medium text-muted-foreground">{$t('editor.preview')}</span>
            </div>
            <MarkdownPreview
              content={noteDetailService.content}
              class="flex-1 overflow-y-auto px-5"
              bind:scrollEl={previewScrollEl}
              bind:contentEl={previewContentEl}
              onrender={onpreviewrender}
              onNoteLink={onnotelink}
              {resolveNoteTitle}
              {imageLoadMode}
            />
          </div>
        </div>
      {:else}
        <div class="w-full px-5 pt-4 pb-6">
          <div class="mx-auto max-w-3xl">
          <MarkdownPreview
            content={noteDetailService.content}
            bind:scrollEl={previewScrollEl}
            bind:contentEl={previewContentEl}
            onrender={onpreviewrender}
            onNoteLink={onnotelink}
            {resolveNoteTitle}
            {imageLoadMode}
          />
          </div>
        </div>
      {/if}
    </main>
  {/if}
</div>
