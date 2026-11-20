<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import { t } from '$lib/stores/i18n.store';

  /**
   * Floating "New note" button of the phone layout (issue #541). Positioned by
   * the nearest `relative` ancestor: the list area above the sync footer, which
   * already keeps clear of the bottom safe area. The corner follows the text
   * direction (end side). Scroll areas under it reserve room with
   * `--rn-fab-clearance` so the last row can scroll out from behind it.
   *
   * Brand yellow with a dark icon in both themes (`--rn-fab` in app.css). On
   * the light list background the yellow has little edge contrast, so the
   * shadow and a faint ring draw the outline; the dark "+" carries the meaning.
   */
  let { onclick }: { onclick: () => void } = $props();
</script>

<button
  type="button"
  {onclick}
  aria-label={$t('nav.new_note')}
  title={$t('nav.new_note')}
  class="absolute bottom-4 inset-e-4 z-10 flex h-14 w-14 items-center justify-center rounded-full
         bg-rn-fab text-rn-fab-foreground shadow-lg ring-1 ring-black/5 transition
         hover:brightness-95 active:scale-95 focus-visible:outline-none focus-visible:ring-2
         focus-visible:ring-foreground focus-visible:ring-offset-2
         focus-visible:ring-offset-background"
>
  <Plus class="h-6 w-6" />
</button>
