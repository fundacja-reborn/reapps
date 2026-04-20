<script lang="ts">
  /**
   * Invisible helper that auto-closes the mobile sidebar sheet.
   * Closes when:
   *  1. A note is selected (activeNoteId changes to a new truthy value)
   *  2. closeSidebarSignal is incremented (e.g. folder/tag selected → content moves to main area)
   *
   * Must be rendered inside a <Sidebar> (descendant of SidebarProvider) to access the context.
   *
   * Important: skip the first run so that re-opening the sheet (which remounts this component)
   * doesn't immediately close it again because $activeNoteId is already set.
   */
  import { untrack } from 'svelte';
  import { useSidebar } from '@reborn/ui/sidebar';
  import { activeNoteId } from '$lib/stores/notes.store';

  let { closeSidebarSignal = 0 }: { closeSidebarSignal?: number } = $props();

  const sidebar = useSidebar();
  let prevId = untrack(() => $activeNoteId);
  let prevSignal = untrack(() => closeSidebarSignal);

  $effect(() => {
    const id = $activeNoteId;
    if (id && id !== prevId && sidebar.isMobile) {
      sidebar.setOpenMobile(false);
    }
    prevId = id;
  });

  $effect(() => {
    if (closeSidebarSignal !== prevSignal && sidebar.isMobile) {
      sidebar.setOpenMobile(false);
    }
    prevSignal = closeSidebarSignal;
  });
</script>
