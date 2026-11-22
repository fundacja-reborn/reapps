<!--
  @component
  The editor pane of the wide layout while no note is open: the first start
  (nothing to reopen yet), a last note that is gone, a closed or deleted note.
  Instead of a blank pane it offers the two ways in: a new note and search,
  each with its shortcut where one exists.
-->
<script lang="ts">
  import { FilePlus, Lock, Search } from '@lucide/svelte';
  import { Button } from '@reborn/ui';
  import { t } from '$lib/stores/i18n.store';
  import { modShortcut, usesCommandKey } from '$lib/utils/shortcut-label';

  let { oncreate, onsearch }: { oncreate: () => void; onsearch: () => void } = $props();

  const command = usesCommandKey();
  // Cmd+N comes from the File menu of the macOS shell. A browser keeps Ctrl+N /
  // Cmd+N for a new window and does not hand it to the page, and the shell has
  // no menu on the other systems, so the hint is shown only there.
  const newNoteShortcut = __REBORN_DESKTOP__ && command ? modShortcut('N', command) : null;
  // Cmd/Ctrl+K is the notes view's own key (svelte:window in routes/+page.svelte).
  const searchShortcut = modShortcut('K', command);
  // Both hints show only with a mouse or trackpad (`pointer-fine`): a tablet
  // without a keyboard has no Cmd or Ctrl to press.
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center">
  <div class="flex flex-col items-center gap-1">
    <h2 class="text-base font-medium text-foreground">{$t('notes.no_note_open')}</h2>
    <p class="max-w-xs text-sm text-muted-foreground">{$t('notes.no_note_open_hint')}</p>
  </div>

  <div class="flex w-full max-w-60 flex-col gap-2">
    <Button onclick={oncreate} class="w-full">
      <FilePlus />
      <span class="flex-1 text-start">{$t('nav.new_note')}</span>
      {#if newNoteShortcut}
        <kbd dir="ltr" class="hidden font-sans text-xs opacity-70 pointer-fine:inline">
          {newNoteShortcut}
        </kbd>
      {/if}
    </Button>
    <Button variant="outline" onclick={onsearch} class="w-full">
      <Search />
      <span class="flex-1 text-start">{$t('nav.search')}</span>
      <kbd dir="ltr" class="hidden font-sans text-xs text-muted-foreground pointer-fine:inline">
        {searchShortcut}
      </kbd>
    </Button>
  </div>

  <p class="flex items-center gap-1.5 text-xs text-muted-foreground/70">
    <Lock class="h-3 w-3 shrink-0" />
    {$t('notes.e2e_info')}
  </p>
</div>
