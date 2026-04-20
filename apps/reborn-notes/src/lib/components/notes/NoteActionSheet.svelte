<script lang="ts">
  import {
    Pin,
    PinOff,
    Star,
    StarOff,
    FolderInput,
    Download,
    Link2,
    ScanEye,
    Trash2,
    RotateCcw,
    Trash,
    Clock
  } from '@lucide/svelte';
  import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import type { NoteListItem } from '$lib/stores/notes.store';

  let {
    open = $bindable(false),
    note,
    isTrash = false,
    onpin,
    onstar,
    onmove,
    onexport,
    oncopylink,
    ondelete,
    onrestore,
    onpermanentdelete,
    onhistory,
    onshowxray
  }: {
    open: boolean;
    note: NoteListItem | null;
    isTrash?: boolean;
    onpin: (id: string) => void;
    onstar: (id: string) => void;
    onmove: (id: string) => void;
    onexport: (note: NoteListItem) => void;
    oncopylink: (note: NoteListItem) => void;
    ondelete: (id: string) => void;
    onrestore: (id: string) => void;
    onpermanentdelete: (id: string) => void;
    /** Opens version history panel (mobile only) */
    onhistory?: () => void;
    /** Opens Encryption X-Ray panel */
    onshowxray?: () => void;
  } = $props();
</script>

<Sheet bind:open>
  <SheetContent side="bottom" class="h-auto">
    <SheetHeader class="text-left">
      <SheetTitle class="line-clamp-2 text-left">{note?.title || $t('notes.untitled')}</SheetTitle>
    </SheetHeader>
    <div class="mt-4 space-y-1">
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
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && onexport(note)}
        >
          <Download class="mr-2 h-4 w-4" />
          {$t('notes.export_markdown')}
        </Button>
        <Button
          variant="ghost"
          class="w-full justify-start"
          onclick={() => note && oncopylink(note)}
        >
          <Link2 class="mr-2 h-4 w-4" />
          {$t('notes.copy_note_link')}
        </Button>
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
        {#if onshowxray}
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
