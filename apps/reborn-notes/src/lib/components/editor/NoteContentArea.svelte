<script lang="ts">
  import { resolve } from '$app/paths';
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

  // Matches a GFM task marker `- [ ]` / `- [x]` / `* [X]` / `+ [ ]` exactly
  // where the parser would recognise one: at the start of a line (allowing
  // any leading indent), bullet char + space, square-bracketed marker, then
  // a single trailing space. The same pattern is used by the Live Preview
  // toggle in `decorations.ts` — keep them in sync.
  const TASK_MARKER_RE = /^([ \t]*[-+*] )(\[[ xX]\])( )/gm;

  /**
   * Toggle the Nth GFM task marker (zero-based) in `source` to `desired` and
   * return the new string. Used to map a checkbox click in MarkdownPreview
   * back to a markdown source edit. If the index doesn't resolve (parser/
   * renderer disagreement, source out of sync), returns the source unchanged.
   */
  function toggleTaskAt(source: string, index: number, desired: boolean): string {
    let i = 0;
    let result: string | null = null;
    source.replace(TASK_MARKER_RE, (match, prefix: string, marker: string, suffix: string, offset: number) => {
      if (i === index && result === null) {
        const newMarker = desired ? '[x]' : '[ ]';
        if (marker !== newMarker) {
          result =
            source.slice(0, offset + prefix.length) +
            newMarker +
            source.slice(offset + prefix.length + marker.length);
        } else {
          result = source;
        }
      }
      i++;
      return match;
    });
    return result ?? source;
  }

  function handleTaskToggle(taskIndex: number, desired: boolean): void {
    const next = toggleTaskAt(noteDetailService.content, taskIndex, desired);
    if (next === noteDetailService.content) return;
    oncontentchange(next);
  }

  // Privacy hint + deep-link to the image-loading preference, surfaced next to
  // the "Load all images" button so the owner understands why their own images
  // don't auto-load and can flip the default in one click. MarkdownPreview only
  // renders the row when imageLoadMode === 'ask' AND the note contains external
  // images, so passing these props unconditionally is safe — they stay hidden
  // when they wouldn't apply.
  const loadAllImagesHint = $derived($t('editor.image_load_all_hint'));
  const settingsLinkLabel = $derived($t('editor.image_load_all_settings_link'));
  const settingsLinkHref = resolve('/settings/appearance');
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
              onTaskToggle={handleTaskToggle}
              {resolveNoteTitle}
              {imageLoadMode}
              {loadAllImagesHint}
              {settingsLinkLabel}
              {settingsLinkHref}
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
            onTaskToggle={handleTaskToggle}
            {resolveNoteTitle}
            {imageLoadMode}
            {loadAllImagesHint}
            {settingsLinkLabel}
            {settingsLinkHref}
          />
          </div>
        </div>
      {/if}
    </main>
  {/if}
</div>
