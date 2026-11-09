<script lang="ts">
  import { Folder, FolderOpen } from '@lucide/svelte';
  import { appearanceTextClass } from '$lib/utils/appearance-colors';
  import { folderIconComponent } from './folder-icon-components';

  /**
   * A folder's icon in its chosen color (from the encrypted metadata bundle).
   * Decorative: every place that renders it also renders the folder's name,
   * so it is hidden from assistive tech and color never carries meaning on
   * its own. Without a custom icon it is the plain folder (open variant when
   * `open`); an unknown color/icon key (written by a newer app version)
   * renders as the default.
   */
  let {
    color,
    icon,
    open = false,
    class: className = 'h-4 w-4'
  }: {
    color?: string;
    icon?: string;
    /** Use the open-folder variant (expanded tree row) when no custom icon is set. */
    open?: boolean;
    /** Size and layout classes; the color class is added here. */
    class?: string;
  } = $props();

  const Custom = $derived(folderIconComponent(icon));
  const Glyph = $derived(Custom ?? (open ? FolderOpen : Folder));
  const colorClass = $derived(appearanceTextClass(color) ?? 'text-muted-foreground');
</script>

<!-- Lucide sets aria-hidden itself when no a11y prop is passed. -->
<Glyph class="shrink-0 {className} {colorClass}" />
