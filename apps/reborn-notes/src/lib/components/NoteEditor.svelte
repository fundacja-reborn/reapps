<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
  import { EditorState, Compartment } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import {
    syntaxHighlighting,
    defaultHighlightStyle,
    ensureSyntaxTree
  } from '@codemirror/language';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { noteLinkAutocomplete, type NoteLinkItem } from '$lib/editor/note-link-autocomplete';
  import { noteLinkDecoration } from '$lib/editor/note-link-decoration';
  import {
    createLivePreviewExtension,
    getMarkdownExtension,
    rebuildLivePreview,
    registerCodeBlockView
  } from '$lib/editor/live-preview';
  import { editorMode } from '$lib/stores/app-settings.store';
  import type { ImageLoadMode } from '@reborn/storage';
  import { isDataUri } from '$lib/utils/markdown-sanitizer';
  import { toastStore } from '@reborn/ui';
  import {
    Bold,
    Italic,
    Strikethrough,
    Code,
    Link,
    List,
    ListOrdered,
    Quote,
    SquareCode,
    Undo2,
    Redo2,
    FileText,
    ImageIcon,
    Table2
  } from '@lucide/svelte';
  import * as Dialog from '@reborn/ui/components/dialog';
  import { undo, redo } from '@codemirror/commands';
  import { t } from '$lib/stores/i18n.store';

  let {
    content = '',
    placeholder = 'Start writing...',
    readonly = false,
    parentScroll = false,
    isMobile = false,
    splitView = false,
    onchange,
    onscrollerinit,
    onviewinit,
    onviewdestroy,
    onnotelinkrequest,
    onnotelinkclick,
    availableNotes = [],
    currentNoteId = null,
    imageLoadMode = 'ask' as ImageLoadMode
  }: {
    content?: string;
    placeholder?: string;
    readonly?: boolean;
    /** When true, the editor grows to content height (no own scroll) and toolbar becomes sticky + centered. */
    parentScroll?: boolean;
    /** When true, the editor renders the mobile toolbar (sticky on top of editor). */
    isMobile?: boolean;
    /** When true, indicates editor is in split view context (toolbar full-width, no max-w centering). */
    splitView?: boolean;
    onchange?: (content: string) => void;
    /** Called once after CM6 mounts — passes the scrollable .cm-scroller element */
    onscrollerinit?: (el: HTMLElement) => void;
    /**
     * Called once after CM6 mounts — passes the EditorView. Used by
     * scroll-sync to build a line-based adapter; safe to ignore.
     */
    onviewinit?: (view: EditorView) => void;
    /** Called once before the EditorView is destroyed (for adapter cleanup). */
    onviewdestroy?: () => void;
    /** Called when user requests to insert a note link (toolbar button or Ctrl+Shift+K) */
    onnotelinkrequest?: () => void;
    /** Called when a rendered note-link widget is clicked (Live Preview mode) */
    onnotelinkclick?: (noteId: string) => void;
    /** Notes available for [[ autocomplete */
    availableNotes?: NoteLinkItem[];
    /** Current note id (excluded from autocomplete suggestions) */
    currentNoteId?: string | null;
    /** User preference for external image loading — drives `ImageWidget` rendering. */
    imageLoadMode?: ImageLoadMode;
  } = $props();

  let editorRootEl: HTMLDivElement;
  let editorContainer: HTMLDivElement;
  let view: EditorView | undefined;
  let isExternalUpdate = false;
  const themeCompartment = new Compartment();
  const readonlyCompartment = new Compartment();
  const autocompleteCompartment = new Compartment();
  const livePreviewCompartment = new Compartment();

  function isDark(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  /**
   * Builds the Live Preview options bag from an explicit mode argument + i18n.
   *
   * Mode is passed in (rather than read from the closure) so the `$effect`
   * below can read `imageLoadMode` directly into a `const` — that read is the
   * reactive dep, and an explicit assignment can't be silently DCE'd. The
   * helper itself stays a plain function; calling it from inside or outside
   * a reactive context is equally safe.
   */
  function livePreviewOptions(mode: ImageLoadMode) {
    return {
      imageLoadMode: mode,
      imageLabels: {
        load: $t('editor.image_load'),
        base64Blocked: $t('editor.image_base64_blocked')
      }
    };
  }

  // ── Formatting helpers ──────────────────────────────────────────

  function wrapSelection(marker: string): boolean {
    if (!view) return false;
    const { state } = view;
    const sel = state.selection.main;
    const selected = state.sliceDoc(sel.from, sel.to);

    let insert: string;
    let anchor: number;
    let head: number;

    if (selected) {
      if (
        selected.startsWith(marker) &&
        selected.endsWith(marker) &&
        selected.length > marker.length * 2
      ) {
        insert = selected.slice(marker.length, -marker.length);
        anchor = sel.from;
        head = sel.from + insert.length;
      } else {
        insert = `${marker}${selected}${marker}`;
        anchor = sel.from;
        head = sel.from + insert.length;
      }
    } else {
      insert = `${marker}${marker}`;
      anchor = sel.from + marker.length;
      head = anchor;
    }

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor, head }
    });
    view.focus();
    return true;
  }

  function prefixLine(prefix: string): boolean {
    if (!view) return false;
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.from);
    const text = line.text;

    if (text.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
        selection: { anchor: line.from }
      });
    } else {
      // Remove other common prefixes first
      const stripped = text.replace(/^(#{1,6} |> |- |\d+\. )/, '');
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: `${prefix}${stripped}` },
        selection: { anchor: line.from + prefix.length }
      });
    }
    view.focus();
    return true;
  }

  function insertHeading(level: number): boolean {
    return prefixLine('#'.repeat(level) + ' ');
  }

  function insertLink(): boolean {
    if (!view) return false;
    const { state } = view;
    const sel = state.selection.main;
    const selected = state.sliceDoc(sel.from, sel.to);
    const text = selected || $t('editor.link_text');
    const insert = `[${text}](url)`;
    const urlStart = sel.from + text.length + 3;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: urlStart, head: urlStart + 3 }
    });
    view.focus();
    return true;
  }

  export function insertNoteLink(noteId: string, title: string): void {
    if (!view) return;
    const { state } = view;
    const sel = state.selection.main;
    const insert = `[${title}](note:${noteId})`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length }
    });
    view.focus();
  }

  function insertCodeBlock(): boolean {
    if (!view) return false;
    const { state } = view;
    const sel = state.selection.main;
    const selected = state.sliceDoc(sel.from, sel.to);

    if (selected.includes('\n') || !selected) {
      const insert = selected ? `\`\`\`\n${selected}\n\`\`\`` : '```\n\n```';
      const anchor = selected ? sel.from + insert.length : sel.from + 4;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor } });
    } else {
      wrapSelection('`');
    }
    view.focus();
    return true;
  }

  let showImageDialog = $state(false);
  let imageUrl = $state('');
  let imageAlt = $state('');
  let isBase64Url = $derived(isDataUri(imageUrl));

  function openImageDialog() {
    if (isMobile) view?.contentDOM.blur();
    imageUrl = '';
    imageAlt = '';
    showImageDialog = true;
  }

  function insertImage() {
    if (!view || !imageUrl.trim()) return;
    if (isDataUri(imageUrl.trim())) {
      toastStore.warning($t('editor.image_base64_blocked'));
      return;
    }
    const { state } = view;
    const sel = state.selection.main;
    const alt = imageAlt.trim() || 'image';
    const insert = `![${alt}](${imageUrl.trim()})`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length }
    });
    view.focus();
    showImageDialog = false;
  }

  function handleImageDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertImage();
    } else if (e.key === 'Escape') {
      showImageDialog = false;
    }
  }

  // ── Table insert ────────────────────────────────────────────────

  let showTableDialog = $state(false);
  let tableCols = $state(3);
  let tableRows = $state(2);

  function openTableDialog() {
    if (isMobile) view?.contentDOM.blur();
    tableCols = 3;
    tableRows = 2;
    showTableDialog = true;
  }

  function insertTable() {
    const cols = Number.isFinite(tableCols) ? Math.floor(tableCols) : 0;
    const rows = Number.isFinite(tableRows) ? Math.floor(tableRows) : 0;
    if (!view || cols < 1 || cols > 10 || rows < 0 || rows > 20) return;
    const { state } = view;
    const sel = state.selection.main;

    const header = '| ' + Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(' | ') + ' |';
    const separator = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
    const emptyRow = '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |';
    const bodyRows = rows > 0 ? '\n' + Array.from({ length: rows }, () => emptyRow).join('\n') : '';

    const insert = header + '\n' + separator + bodyRows + '\n';

    // Place cursor at first header cell content ("Col 1")
    const cursorPos = sel.from + 2;

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: cursorPos, head: cursorPos + `Col 1`.length }
    });
    view.focus();
    showTableDialog = false;
  }

  function handleTableDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertTable();
    } else if (e.key === 'Escape') {
      showTableDialog = false;
    }
  }

  // ── Editor init ─────────────────────────────────────────────────

  onMount(() => {
    const customKeymap = keymap.of([
      { key: 'Mod-b', run: () => wrapSelection('**') },
      { key: 'Mod-i', run: () => wrapSelection('_') },
      { key: 'Mod-k', run: () => insertLink() },
      {
        key: 'Mod-Shift-k',
        run: () => {
          onnotelinkrequest?.();
          return true;
        }
      },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab
    ]);

    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        getMarkdownExtension(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        customKeymap,
        themeCompartment.of(isDark() ? oneDark : []),
        readonlyCompartment.of(EditorState.readOnly.of(readonly)),
        placeholderExt(placeholder),
        autocompleteCompartment.of(noteLinkAutocomplete(() => availableNotes, currentNoteId)),
        livePreviewCompartment.of(
          $editorMode === 'live' && !splitView
            ? createLivePreviewExtension(livePreviewOptions(imageLoadMode))
            : []
        ),
        noteLinkDecoration,
        EditorView.domEventHandlers({
          click(e) {
            const target = e.target as HTMLElement | null;
            const noteEl = target?.closest('[data-note-link="true"]') as HTMLElement | null;
            if (noteEl) {
              const noteId = noteEl.dataset.noteId;
              if (noteId) {
                e.preventDefault();
                onnotelinkclick?.(noteId);
              }
            }
          },
          paste(e) {
            const files = e.clipboardData?.files;
            if (files && files.length > 0) {
              for (const file of Array.from(files)) {
                if (file.type.startsWith('image/')) {
                  e.preventDefault();
                  toastStore.warning($t('editor.image_paste_blocked'));
                  return;
                }
              }
            }
            const text = e.clipboardData?.getData('text/plain') ?? '';
            if (/!\[[^\]]*\]\(data:/i.test(text)) {
              e.preventDefault();
              toastStore.warning($t('editor.image_base64_blocked'));
              return;
            }
          },
          drop(e) {
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
              for (const file of Array.from(files)) {
                if (file.type.startsWith('image/')) {
                  e.preventDefault();
                  toastStore.warning($t('editor.image_drop_blocked'));
                  return;
                }
              }
            }
          }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isExternalUpdate) {
            const doc = update.state.doc.toString();
            onchange?.(doc);
          }
        })
      ]
    });

    view = new EditorView({ state, parent: editorContainer });
    onviewinit?.(view);

    // Force the markdown parser to fully parse the initial doc before the
    // view plugin reads `syntaxTree(state)`. Without this, on a freshly-
    // mounted editor with `editorMode === 'live'` and content that contains
    // fenced code, the first paint sees a partial tree → no FencedCode
    // nodes → no widget → user sees raw markdown until the next click. The
    // 50ms budget is generous; for normal notes the parser finishes in <1ms.
    ensureSyntaxTree(view.state, view.state.doc.length, 50);
    view.dispatch({ effects: rebuildLivePreview.of(null) });

    // Larger notes can hit the 50ms budget above with a partial parse tree,
    // leaving some FencedCode blocks as raw markdown until the next user
    // transaction. Schedule a follow-up rebuild during idle time with a
    // generous 500ms parse budget to finish the tree off-thread of paint.
    const runIdleRebuild = () => {
      if (!view) return;
      ensureSyntaxTree(view.state, view.state.doc.length, 500);
      view.dispatch({ effects: rebuildLivePreview.of(null) });
    };
    const hasIdleCallback = typeof requestIdleCallback === 'function';
    const idleId: number = hasIdleCallback
      ? requestIdleCallback(runIdleRebuild, { timeout: 1000 })
      : (setTimeout(runIdleRebuild, 250) as unknown as number);

    // Allow CodeBlockWidget to force a live-preview rebuild after a lazy
    // language chunk finishes loading (so plaintext placeholder is replaced
    // by the highlighted version on the next frame).
    const unregisterCodeBlock = registerCodeBlockView(view, (v) => {
      v.dispatch({ effects: rebuildLivePreview.of(null) });
    });

    // Expose the CM6 scroller element for parent scroll-sync
    const scroller = editorContainer.querySelector('.cm-scroller') as HTMLElement | null;
    if (scroller) onscrollerinit?.(scroller);

    // Sync dark mode with HTML class changes
    const observer = new MutationObserver(() => {
      view?.dispatch({
        effects: themeCompartment.reconfigure(isDark() ? oneDark : [])
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // When the soft keyboard opens (visualViewport shrinks significantly),
    // pull the caret into the visible area. Both layouts size their scroll
    // container to vv.height (mobile root in +page.svelte / SidebarProvider
    // on desktop), so this dispatch nudges the scroll so the line under the
    // caret lands comfortably above the keyboard. Threshold of 100px filters
    // out incidental resizes (browser chrome show/hide, address bar) — only
    // a soft keyboard moves vv.height by more than that. Only fires when the
    // editor has focus, so split view's unfocused pane doesn't scroll.
    let prevVvHeight = window.visualViewport?.height ?? 0;
    const handleVvResize = () => {
      if (!view) return;
      const vv = window.visualViewport;
      if (!vv) return;
      const next = vv.height;
      const shrankByKeyboard = prevVvHeight - next > 100;
      prevVvHeight = next;
      if (!shrankByKeyboard) return;
      if (!view.hasFocus) return;
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' })
      });
    };
    window.visualViewport?.addEventListener('resize', handleVvResize);

    return () => {
      if (hasIdleCallback && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
      else clearTimeout(idleId);
      observer.disconnect();
      unregisterCodeBlock();
      window.visualViewport?.removeEventListener('resize', handleVvResize);
    };
  });

  // Sync content prop → editor when changed externally (without triggering onchange)
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (content !== current) {
      isExternalUpdate = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content }
      });
      isExternalUpdate = false;
    }
  });

  // Sync readonly prop
  $effect(() => {
    view?.dispatch({
      effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(readonly))
    });
  });

  // Sync autocomplete notes list
  $effect(() => {
    // Access reactive props to track them
    const notes = availableNotes;
    const noteId = currentNoteId;
    view?.dispatch({
      effects: autocompleteCompartment.reconfigure(noteLinkAutocomplete(() => notes, noteId))
    });
  });

  // Sync editor mode (markdown ↔ live preview) AND image-loading preference.
  // Both `$editorMode` and `imageLoadMode` are read into local consts before
  // the dispatch — explicit reads with side-effecting bindings can't be
  // optimised out, guaranteeing Svelte tracks them as deps. Toggling either
  // setting reconfigures the compartment and `ImageWidget` re-renders
  // without a remount. In split view the right pane already renders the
  // preview, so the editor pane always shows raw Markdown regardless of
  // editorMode.
  $effect(() => {
    const mode = $editorMode;
    const currentImageMode = imageLoadMode;
    const live = mode === 'live' && !splitView;
    view?.dispatch({
      effects: livePreviewCompartment.reconfigure(
        live ? createLivePreviewExtension(livePreviewOptions(currentImageMode)) : []
      )
    });
  });

  onDestroy(() => {
    onviewdestroy?.();
    view?.destroy();
  });
</script>

<div bind:this={editorRootEl} class="flex flex-col" class:h-full={!parentScroll}>
  <!-- Toolbar -->
  {#if !readonly}
    {#snippet toolbarButtons()}
      <!-- History -->
      <button
        type="button"
        onclick={() => view && undo(view)}
        title={$t('editor.undo_shortcut')}
        class="toolbar-btn"
        aria-label={$t('editor.undo')}
      >
        <Undo2 class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={() => view && redo(view)}
        title={$t('editor.redo_shortcut')}
        class="toolbar-btn"
        aria-label={$t('editor.redo')}
      >
        <Redo2 class="h-4 w-4" />
      </button>

      <div class="mx-1 h-5 w-px bg-border" role="separator"></div>

      <!-- Headings -->
      <button
        type="button"
        onclick={() => insertHeading(1)}
        title={$t('editor.formatting.heading1')}
        class="toolbar-btn font-bold"
        aria-label={$t('editor.formatting.heading1')}>H1</button
      >
      <button
        type="button"
        onclick={() => insertHeading(2)}
        title={$t('editor.formatting.heading2')}
        class="toolbar-btn font-bold"
        aria-label={$t('editor.formatting.heading2')}>H2</button
      >
      <button
        type="button"
        onclick={() => insertHeading(3)}
        title={$t('editor.formatting.heading3')}
        class="toolbar-btn font-bold"
        aria-label={$t('editor.formatting.heading3')}>H3</button
      >

      <div class="mx-1 h-5 w-px bg-border" role="separator"></div>

      <!-- Inline formatting -->
      <button
        type="button"
        onclick={() => wrapSelection('**')}
        title={$t('editor.formatting.bold') + ' (Ctrl+B)'}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.bold')}
      >
        <Bold class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={() => wrapSelection('_')}
        title={$t('editor.formatting.italic') + ' (Ctrl+I)'}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.italic')}
      >
        <Italic class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={() => wrapSelection('~~')}
        title={$t('editor.formatting.strikethrough')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.strikethrough')}
      >
        <Strikethrough class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={() => wrapSelection('`')}
        title={$t('editor.formatting.code')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.code')}
      >
        <Code class="h-4 w-4" />
      </button>

      <div class="mx-1 h-5 w-px bg-border" role="separator"></div>

      <!-- Block elements -->
      <button
        type="button"
        onclick={() => prefixLine('- ')}
        title={$t('editor.formatting.bullet_list')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.bullet_list')}
      >
        <List class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={() => prefixLine('1. ')}
        title={$t('editor.formatting.numbered_list')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.numbered_list')}
      >
        <ListOrdered class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={() => prefixLine('> ')}
        title={$t('editor.formatting.quote')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.quote')}
      >
        <Quote class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={insertCodeBlock}
        title={$t('editor.formatting.code_block')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.code_block')}
      >
        <SquareCode class="h-4 w-4" />
      </button>
      <button
        type="button"
        onclick={openTableDialog}
        title={$t('editor.formatting.insert_table')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.insert_table')}
      >
        <Table2 class="h-4 w-4" />
      </button>

      <div class="mx-1 h-5 w-px bg-border" role="separator"></div>

      <!-- Link -->
      <button
        type="button"
        onclick={insertLink}
        title={$t('editor.formatting.link') + ' (Ctrl+K)'}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.link')}
      >
        <Link class="h-4 w-4" />
      </button>

      <!-- Note Link -->
      <button
        type="button"
        onclick={() => onnotelinkrequest?.()}
        title={$t('editor.formatting.note_link') + ' (Ctrl+Shift+K)'}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.note_link')}
      >
        <FileText class="h-4 w-4" />
      </button>

      <div class="mx-1 h-5 w-px bg-border" role="separator"></div>

      <!-- Insert Image -->
      <button
        type="button"
        onclick={openImageDialog}
        title={$t('editor.formatting.insert_image')}
        class="toolbar-btn"
        aria-label={$t('editor.formatting.insert_image')}
      >
        <ImageIcon class="h-4 w-4" />
      </button>
    {/snippet}

    {#if isMobile}
      <!-- Mobile: sticky toolbar at top of editor.
           Position is deterministic — independent of virtual keyboard state
           and Stage Manager edge-cases on iPad. -->
      <div class="mobile-toolbar sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b">
        <div class="flex flex-nowrap items-center gap-0.5 overflow-x-auto px-2 py-1.5">
          {@render toolbarButtons()}
        </div>
      </div>
    {:else if parentScroll && !splitView}
      <div class="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-5">
        <div class="mx-auto max-w-3xl">
          <div class="flex flex-wrap items-center gap-0.5 py-1.5">
            {@render toolbarButtons()}
          </div>
        </div>
      </div>
    {:else if parentScroll && splitView}
      <!-- Split: sticky toolbar, full-width (no max-w centering) -->
      <div class="sticky -top-px z-10 bg-background/95 backdrop-blur-sm border-t border-b">
        <div class="flex flex-nowrap items-center gap-0.5 overflow-x-auto px-2 py-1.5">
          {@render toolbarButtons()}
        </div>
      </div>
    {:else}
      <div class="flex flex-wrap items-center gap-0.5 border-b bg-background px-2 py-1.5">
        {@render toolbarButtons()}
      </div>
    {/if}
  {/if}

  <!-- Image insert dialog (portaled via shadcn Dialog) -->
  <Dialog.Root bind:open={showImageDialog}>
    <Dialog.Content class="max-w-sm gap-0 p-0" onkeydown={handleImageDialogKeydown}>
      <Dialog.Header class="border-b px-4 py-3">
        <Dialog.Title class="text-sm font-medium">{$t('editor.formatting.insert_image')}</Dialog.Title>
      </Dialog.Header>
      <div class="space-y-3 px-4 py-4">
        <div>
          <label class="block text-[0.8125rem] font-medium text-foreground mb-1" for="image-url-input">{$t('editor.image_url')}</label>
          <input
            id="image-url-input"
            type="url"
            bind:value={imageUrl}
            placeholder="https://example.com/photo.jpg"
            class="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            class:border-destructive={isBase64Url}
          />
          {#if isBase64Url}
            <p class="mt-1 text-xs text-destructive">{$t('editor.image_base64_blocked')}</p>
          {/if}
        </div>
        <div>
          <label class="block text-[0.8125rem] font-medium text-foreground mb-1" for="image-alt-input">{$t('editor.image_alt')}</label>
          <input
            id="image-alt-input"
            type="text"
            bind:value={imageAlt}
            placeholder={$t('editor.image_alt')}
            class="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-md bg-muted px-3 py-1.5 text-[0.8125rem] text-muted-foreground"
            onclick={() => (showImageDialog = false)}
          >
            {$t('editor.image_cancel')}
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-[0.8125rem] text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={insertImage}
            disabled={!imageUrl.trim() || isBase64Url}
          >
            {$t('editor.image_insert')}
          </button>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>

  <!-- Table insert dialog (portaled via shadcn Dialog) -->
  <Dialog.Root bind:open={showTableDialog}>
    <Dialog.Content class="max-w-sm gap-0 p-0" onkeydown={handleTableDialogKeydown}>
      <Dialog.Header class="border-b px-4 py-3">
        <Dialog.Title class="text-sm font-medium">{$t('editor.formatting.insert_table')}</Dialog.Title>
      </Dialog.Header>
      <div class="space-y-3 px-4 py-4">
        <div>
          <label class="block text-[0.8125rem] font-medium text-foreground mb-1" for="table-cols-input">{$t('editor.table_columns')}</label>
          <input
            id="table-cols-input"
            type="number"
            min="1"
            max="10"
            bind:value={tableCols}
            class="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div>
          <label class="block text-[0.8125rem] font-medium text-foreground mb-1" for="table-rows-input">{$t('editor.table_rows')}</label>
          <input
            id="table-rows-input"
            type="number"
            min="0"
            max="20"
            bind:value={tableRows}
            class="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-md bg-muted px-3 py-1.5 text-[0.8125rem] text-muted-foreground"
            onclick={() => (showTableDialog = false)}
          >
            {$t('editor.table_cancel')}
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-[0.8125rem] text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={insertTable}
            disabled={!tableCols || tableCols < 1 || tableCols > 10}
          >
            {$t('editor.table_insert')}
          </button>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>

  <!-- CodeMirror mount point -->
  <div
    bind:this={editorContainer}
    class="cm-host {parentScroll ? '' : 'min-h-0 flex-1 overflow-auto'}"
    class:cm-parent-scroll={parentScroll}
    aria-label={$t('editor.note_editor')}
  ></div>
</div>

<style>
  :global(.cm-host .cm-editor) {
    height: 100%;
    font-size: inherit;
    line-height: inherit;
  }

  :global(.cm-host.cm-parent-scroll .cm-editor) {
    height: auto;
  }

  :global(.cm-host.cm-parent-scroll .cm-scroller) {
    overflow: visible !important;
  }

  :global(.cm-host .cm-scroller) {
    padding: 1.25rem 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  :global(.cm-host .cm-content) {
    max-width: 48rem; /* max-w-3xl */
    margin: 0 auto;
    font-size: 1rem; /* 16px — prevents iOS auto-zoom on focus */
    line-height: 1.7;
  }

  @media (min-width: 768px) {
    :global(.cm-host .cm-scroller) {
      padding: 1.5rem 1.25rem;
    }
    :global(.cm-host .cm-content) {
      font-size: 0.875rem; /* 14px on desktop */
    }
  }

  :global(.cm-host .cm-editor.cm-focused) {
    outline: none;
  }

  /* Force app background in dark mode (oneDark uses its own #282c34) */
  :global(.dark .cm-host .cm-editor) {
    background-color: var(--background);
  }
  :global(.dark .cm-host .cm-editor .cm-gutters) {
    background-color: var(--background);
    border-right: none;
  }

  /* Light mode */
  :global(.cm-host .cm-editor:not(.cm-dark-theme) .cm-content) {
    caret-color: currentColor;
  }

  /* Live Preview — code block token colors in dark mode.
     Light-mode palette ships in editor/live-preview/theme.ts; CM6 themes
     can't reach .dark on <html>, so dark overrides go here. */
  :global(.dark .cm-host .cm-lp-codeblock .tok-keyword),
  :global(.dark .cm-host .cm-lp-codeblock .tok-controlKeyword),
  :global(.dark .cm-host .cm-lp-codeblock .tok-moduleKeyword),
  :global(.dark .cm-host .cm-lp-codeblock .tok-operatorKeyword),
  :global(.dark .cm-host .cm-lp-codeblock .tok-definitionKeyword) {
    color: #c792ea;
  }
  :global(.dark .cm-host .cm-lp-codeblock .tok-atom),
  :global(.dark .cm-host .cm-lp-codeblock .tok-bool),
  :global(.dark .cm-host .cm-lp-codeblock .tok-number) {
    color: #f78c6c;
  }
  :global(.dark .cm-host .cm-lp-codeblock .tok-string),
  :global(.dark .cm-host .cm-lp-codeblock .tok-special.tok-string),
  :global(.dark .cm-host .cm-lp-codeblock .tok-regexp),
  :global(.dark .cm-host .cm-lp-codeblock .tok-escape) {
    color: #c3e88d;
  }
  :global(.dark .cm-host .cm-lp-codeblock .tok-comment),
  :global(.dark .cm-host .cm-lp-codeblock .tok-lineComment),
  :global(.dark .cm-host .cm-lp-codeblock .tok-blockComment) {
    color: #7c8a99;
  }
  :global(.dark .cm-host .cm-lp-codeblock .tok-variableName),
  :global(.dark .cm-host .cm-lp-codeblock .tok-propertyName),
  :global(.dark .cm-host .cm-lp-codeblock .tok-attributeName) {
    color: #82aaff;
  }
  :global(.dark .cm-host .cm-lp-codeblock .tok-typeName),
  :global(.dark .cm-host .cm-lp-codeblock .tok-className),
  :global(.dark .cm-host .cm-lp-codeblock .tok-namespace),
  :global(.dark .cm-host .cm-lp-codeblock .tok-macroName) {
    color: #7fdbca;
  }
  :global(.dark .cm-host .cm-lp-codeblock .tok-tagName),
  :global(.dark .cm-host .cm-lp-codeblock .tok-labelName) {
    color: #f07178;
  }

  /* Note link decoration */
  :global(.cm-host .cm-note-link) {
    color: var(--primary);
    text-decoration: underline dashed;
    text-underline-offset: 3px;
    border-radius: 2px;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    transition:
      background-color 0.15s,
      color 0.15s;
  }

  .toolbar-btn:hover {
    background-color: var(--accent);
    color: var(--accent-foreground);
  }

  /* ── Mobile toolbar (sticky at top of editor) ────────────── */
  .mobile-toolbar .toolbar-btn {
    flex-shrink: 0;
    min-width: 2.5rem;
    height: 2.5rem;
    padding: 0 0.375rem;
  }

  /* Enlarge icons inside mobile toolbar for better touch targets */
  .mobile-toolbar .toolbar-btn :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  /* Hide separators inside the mobile toolbar to save horizontal space */
  .mobile-toolbar [role='separator'] {
    display: none;
  }
</style>
