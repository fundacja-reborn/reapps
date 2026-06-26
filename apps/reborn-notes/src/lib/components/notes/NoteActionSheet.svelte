<script lang="ts">
  import {
    Search,
    Pin,
    PinOff,
    Star,
    StarOff,
    FolderInput,
    Download,
    FileText,
    Link2,
    Share2,
    ScanEye,
    Trash2,
    RotateCcw,
    Trash,
    Clock,
    Waypoints,
    ListTree,
    ListPlus,
    RefreshCw,
    ListX
  } from '@lucide/svelte';
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import type { NoteListItem } from '$lib/stores/notes.store';

  let {
    open = $bindable(false),
    note,
    isTrash = false,
    onsearch,
    onpin,
    onstar,
    onmove,
    onexport,
    onexportpdf,
    oncopylink,
    onshare,
    ondelete,
    onrestore,
    onpermanentdelete,
    onhistory,
    onlinkednotes,
    onoutline,
    onshowxray,
    tocMenuMode = 'hidden',
    tocStale = false,
    onTocApply,
    onTocRemove
  }: {
    open: boolean;
    note: NoteListItem | null;
    isTrash?: boolean;
    /** Opens the in-note search bar. Only wired in the open-note context. */
    onsearch?: () => void;
    onpin: (id: string) => void;
    onstar: (id: string) => void;
    onmove: (id: string) => void;
    onexport: (note: NoteListItem) => void;
    /** Optional - only shown in the open-note context (NoteList omits it). */
    onexportpdf?: (note: NoteListItem) => void;
    oncopylink: (note: NoteListItem) => void;
    /** Opens read-only share dialog. */
    onshare?: (note: NoteListItem) => void;
    ondelete: (id: string) => void;
    onrestore: (id: string) => void;
    onpermanentdelete: (id: string) => void;
    /** Opens version history panel (mobile only) */
    onhistory?: () => void;
    /** Opens Linked notes panel (mobile only) */
    onlinkednotes?: () => void;
    /** Opens the Outline panel (mobile only) */
    onoutline?: () => void;
    /** Opens Encryption X-Ray panel */
    onshowxray?: () => void;
    /** Table-of-contents menu state: insert / manage / hidden. */
    tocMenuMode?: 'insert' | 'manage' | 'hidden';
    /** Marks the refresh action as out of date (headings drifted). */
    tocStale?: boolean;
    /** Insert-or-refresh the managed TOC block. */
    onTocApply?: () => void;
    /** Remove the managed TOC block. */
    onTocRemove?: () => void;
  } = $props();

  // Whether the "navigate/structure this note" group has anything to show, so
  // its leading separator isn't rendered for list-item sheets (which pass none).
  const hasContentTools = $derived(
    !!onoutline || !!onlinkednotes || !!onhistory || tocMenuMode !== 'hidden'
  );
</script>

<Sheet bind:open>
  <!-- Capped height + scrollable body so a long menu fits a short screen; the
       header (and the sheet's absolute close button) stay pinned while only the
       action list scrolls. -->
  <SheetContent side="bottom" class="flex max-h-[85dvh] flex-col">
    <SheetHeader class="shrink-0 pr-8 text-left">
      <SheetTitle class="line-clamp-2 text-left">{note?.title || $t('notes.untitled')}</SheetTitle>
    </SheetHeader>
    <div class="flex-1 space-y-1 overflow-y-auto">
      {#if isTrash}
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && onrestore(note.id)}
        >
          <RotateCcw class="mr-2 h-4 w-4" />
          {$t('notes.restore')}
        </Button>
        <Button
          variant="ghost"
          class="w-full justify-start text-destructive hover:text-destructive"
          onclick={() => note && onpermanentdelete(note.id)}
        >
          <Trash class="mr-2 h-4 w-4" />
          {$t('notes.delete_permanently')}
        </Button>
      {:else}
        <!-- Find -->
        {#if onsearch}
          <Button
            variant="ghost"
            class="w-full justify-start"
            onclick={() => {
              open = false;
              onsearch?.();
            }}
          >
            <Search class="mr-2 h-4 w-4" />
            {$t('note_search.open')}
          </Button>
          <div class="my-1 h-px bg-border" role="separator"></div>
        {/if}
        <!-- Organize -->
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && onpin(note.id)}
        >
          {#if note?.is_pinned}
            <PinOff class="mr-2 h-4 w-4" />
            {$t('notes.unpin')}
          {:else}
            <Pin class="mr-2 h-4 w-4" />
            {$t('notes.pin_to_top')}
          {/if}
        </Button>
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && onstar(note.id)}
        >
          {#if note?.is_starred}
            <StarOff class="mr-2 h-4 w-4" />
            {$t('notes.unstar')}
          {:else}
            <Star class="mr-2 h-4 w-4" />
            {$t('notes.star')}
          {/if}
        </Button>
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && onmove(note.id)}
        >
          <FolderInput class="mr-2 h-4 w-4" />
          {$t('notes.move_to_folder')}
        </Button>
        <!-- Navigate / structure this note -->
        {#if hasContentTools}
          <div class="my-1 h-px bg-border" role="separator"></div>
          {#if onoutline}
            <Button
              variant="ghost"
              class="w-full justify-start"
              onclick={() => {
                open = false;
                onoutline?.();
              }}
            >
              <ListTree class="mr-2 h-4 w-4" />
              {$t('outline.title')}
            </Button>
          {/if}
          {#if tocMenuMode === 'insert'}
            <Button
              variant="ghost"
              class="w-full justify-start"
              onclick={() => {
                open = false;
                onTocApply?.();
              }}
            >
              <ListPlus class="mr-2 h-4 w-4" />
              {$t('toc.insert')}
            </Button>
          {:else if tocMenuMode === 'manage'}
            <Button
              variant="ghost"
              class="w-full justify-start"
              onclick={() => {
                open = false;
                onTocApply?.();
              }}
            >
              <RefreshCw class="mr-2 h-4 w-4" />
              {$t('toc.refresh')}
              {#if tocStale}
                <span
                  class="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                  aria-hidden="true"
                ></span>
              {/if}
            </Button>
            <Button
              variant="ghost"
              class="w-full justify-start"
              onclick={() => {
                open = false;
                onTocRemove?.();
              }}
            >
              <ListX class="mr-2 h-4 w-4" />
              {$t('toc.remove')}
            </Button>
          {/if}
          {#if onlinkednotes}
            <Button
              variant="ghost"
              class="w-full justify-start"
              onclick={() => {
                open = false;
                onlinkednotes?.();
              }}
            >
              <Waypoints class="mr-2 h-4 w-4" />
              {$t('linked_notes.title')}
            </Button>
          {/if}
          {#if onhistory}
            <Button
              variant="ghost"
              class="w-full justify-start"
              onclick={() => {
                open = false;
                onhistory?.();
              }}
            >
              <Clock class="mr-2 h-4 w-4" />
              {$t('history.title')}
            </Button>
          {/if}
        {/if}
        <!-- Share / export -->
        <div class="my-1 h-px bg-border" role="separator"></div>
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && oncopylink(note)}
        >
          <Link2 class="mr-2 h-4 w-4" />
          {$t('notes.copy_note_link')}
        </Button>
        {#if onshare}
          <Button
            variant="ghost"
            class="w-full justify-start"
            onclick={() => {
              if (note) {
                open = false;
                onshare?.(note);
              }
            }}
          >
            <Share2 class="mr-2 h-4 w-4" />
            {$t('share.note.menu_label')}
          </Button>
        {/if}
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && onexport(note)}
        >
          <Download class="mr-2 h-4 w-4" />
          {$t('notes.export_markdown')}
        </Button>
        {#if onexportpdf}
          <Button
            variant="ghost"
            class="w-full justify-start"
            onclick={() => note && onexportpdf?.(note)}
          >
            <FileText class="mr-2 h-4 w-4" />
            {$t('notes.export_pdf')}
          </Button>
        {/if}
        <!-- Info -->
        {#if onshowxray}
          <div class="my-1 h-px bg-border" role="separator"></div>
          <Button
            variant="ghost"
            class="w-full justify-start"
            onclick={() => {
              open = false;
              onshowxray?.();
            }}
          >
            <ScanEye class="mr-2 h-4 w-4" />
            {$t('encryption.title')}
          </Button>
        {/if}
        <!-- Destructive -->
        <div class="my-1 h-px bg-border" role="separator"></div>
        <Button
          variant="ghost"
          class="w-full justify-start text-destructive hover:text-destructive"
          onclick={() => note && ondelete(note.id)}
        >
          <Trash2 class="mr-2 h-4 w-4" />
          {$t('notes.delete_note')}
        </Button>
      {/if}
    </div>
  </SheetContent>
</Sheet>
